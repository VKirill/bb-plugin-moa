import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Markdown, ThreadChat, useBbContext, useRpc, useRealtime, useRealtimeConnectionState,
  experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";
import type { Audit, Slot, rpcContract } from "./contract";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const ru = typeof navigator !== "undefined" && navigator.languages.some(l => l.startsWith("ru"));
const t = (en: string, russian: string) => ru ? russian : en;
export function readablePayload(text: string) {
  return text.split("\n").map(line => {
    if (/^\[bb-moa-reference:/.test(line)) return "";
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.advice === "string") return parsed.advice;
      if (Array.isArray(parsed.advisors)) return parsed.advisors.map((a: { model?: string; advice?: string }) => `### ${a.model ?? "Advisor"}\n\n${a.advice ?? ""}`).join("\n\n");
    } catch { /* Ordinary text is preserved. */ }
    if (line.startsWith("Canonical conversation updates")) return t("## Shared conversation history", "## Переданная история чата");
    if (line === "Current user request:") return t("## Current request", "## Текущий запрос");
    return line;
  }).join("\n");
}
export const HISTORY_TITLE = t("MoA: consultation history", "MoA: история консультации");
type Target = { threadId: string; runId: string };
let target: Target | null = null;
const listeners = new Set<() => void>();
const indexes = new Map<string, { rowId: string; runId: string; sourceSeq: number }[]>();
const styleListeners = new Set<() => void>();
export function showAudit(value: Target | null) { target = value; for (const fn of listeners) fn(); }
export function openMessageAudit(threadId: string, messageId: string) {
  const entry = indexes.get(threadId)?.find(row => row.rowId === messageId);
  if (entry) showAudit({ threadId, runId: entry.runId });
}
// Public messageAction owns the button and click. The current SDK lacks a
// per-message availability predicate, so a content script narrows visibility
// using the native row anchors observed on BB 0.43.1. Never match question text.
export function mountHistoryVisibility() {
  const style = document.createElement("style");
  style.dataset.bbMoa = "message-history";
  const update = () => {
    const button = `button[aria-label=${JSON.stringify(HISTORY_TITLE)}]`;
    const rows = [...indexes.values()].flat().filter(row => /^[\w:-]+$/.test(row.rowId));
    style.textContent = `${button} { display: none !important; }\n` + rows.map(row =>
      `[data-timeline-row-id="${row.rowId}"] ${button} { display: inline-flex !important; }`).join("\n");
  };
  styleListeners.add(update); update(); document.head.append(style);
  return () => { styleListeners.delete(update); style.remove(); };
}
export function ModelBadge({ slot }: { slot: Slot }) {
  const name = slot.model.replace(/^gpt-/, "").replace(/^gemini-/, "Gemini ").replace(/-/g, " ");
  return <span className="inline-flex items-center gap-1" title={`${slot.providerId} · ${slot.model} · ${slot.reasoningLevel}`}>
    <ProviderIcon providerKind="agent" provider={{ id: slot.providerId }} className="size-3.5 shrink-0" />
    <span>{name}</span>
  </span>;
}
function Bubble({ title, body, user = false }: { title: string; body: string; user?: boolean }) {
  return <article className={`max-w-[95%] rounded-xl border border-border p-4 ${user ? "ml-auto bg-muted" : "mr-auto bg-card"}`}>
    <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
    <Markdown content={body} className="text-sm" />
  </article>;
}
export function HistoryOverlay() {
  const current = useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => target);
  const { threadId } = useBbContext();
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [detail, setDetail] = useState<Audit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("message");
  const refreshIndex = useCallback(async () => {
    if (!threadId) return;
    try {
      const rows = await rpc.call("messageIndex", { threadId });
      indexes.set(threadId, rows); for (const fn of styleListeners) fn();
    } catch { /* Keep already verified anchors through a temporary reconnect. */ }
  }, [rpc, threadId]);
  const refreshDetail = useCallback(async () => {
    if (!current) return;
    try {
      const result = await rpc.call("audit", current);
      if (target === current) { setDetail(result); setError(null); }
    } catch (cause) { if (target === current) setError(cause instanceof Error ? cause.message : "Could not load consultation."); }
  }, [rpc, current]);
  useEffect(() => { void refreshIndex(); }, [refreshIndex, connection]);
  useEffect(() => { setDetail(null); setError(null); setTab("message"); void refreshDetail(); }, [refreshDetail]);
  useRealtime("changed", payload => {
    if (!payload || typeof payload !== "object") return;
    if ("threadId" in payload && payload.threadId === threadId && (!("status" in payload) || payload.status === "dispatched")) void refreshIndex();
    if (current && "threadId" in payload && payload.threadId === current.threadId) void refreshDetail();
  });
  const members = detail?.members ?? (detail ? [{ member: { key: "b" as const, advisor: detail.run.advisor, workerId: detail.run.workerId,
    status: detail.run.advice ? "ready" : "running", startedAt: detail.run.startedAt, finishedAt: detail.run.finishedAt,
    advice: detail.run.advice, error: detail.run.error }, input: detail.advisorInput, requestedAt: detail.advisorRequestedAt, inputVerified: detail.advisorInputVerified }] : []);
  const sessions = members.flatMap(({ member }, i) => [
    { id: `session-${i}`, workerId: member.workerId, label: members.length === 1 ? t("Advisor session", "Сессия советника") : `${t("Session", "Сессия")} ${member.key.toUpperCase()} · ${member.advisor.model}` },
    ...(member.attempts ?? []).map((attempt, j) => ({ id: `attempt-${i}-${j}`, workerId: attempt.workerId, label: `${member.key.toUpperCase()} · ${attempt.advisor.model} (${t("prior attempt", "первая попытка")})` })),
  ]);
  const selectedSession = sessions.find(session => tab === session.id);
  const [replacing, setReplacing] = useState<string | null>(null);
  async function replace(key: "a" | "b") {
    if (!current) return;
    setReplacing(key); setError(null);
    try { await rpc.call("replaceParticipant", { ...current, key }); await refreshDetail(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Replacement failed."); }
    finally { setReplacing(null); }
  }
  return <Dialog open={!!current} onOpenChange={open => { if (!open) showAudit(null); }}>
    <DialogContent className="flex max-h-[88vh] flex-col gap-3 sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle>{HISTORY_TITLE}</DialogTitle>
        <DialogDescription>{t("The actual request, the advisor's answer, and what was delivered to the acting model.", "Что поступило советнику, что он ответил и что было передано основной модели.")}</DialogDescription>
      </DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!detail && !error && <p className="text-sm text-muted-foreground">{t("Loading consultation…", "Загрузка консультации…")}</p>}
      {detail && <>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {members.map(({ member }, i) => <span key={member.key} className="inline-flex items-center gap-1">{i > 0 && <span>+</span>}<ModelBadge slot={member.advisor} /></span>)}<span>→</span><ModelBadge slot={detail.run.aggregator} />
          <span className="text-muted-foreground">· {Math.round(((detail.run.finishedAt ?? Date.now()) - detail.run.startedAt) / 1000)} {t("s", "с")}</span>
          {detail.run.partial && <span className="text-muted-foreground">{t("1 of 2 answers · fallback", "1 из 2 ответов · фоллбек")}</span>}
          <span className="rounded-full bg-muted px-2 py-1">{detail.mainInputVerified ? t("Delivery confirmed", "Передача подтверждена") : t("Not delivered", "Ещё не передано")}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={tab === "message" ? "secondary" : "ghost"} onClick={() => setTab("message")}>{t("This message", "Это сообщение")}</Button>
          {sessions.map(session => <Button key={session.id} size="sm" variant={tab === session.id ? "secondary" : "ghost"} disabled={!session.workerId} onClick={() => setTab(session.id)}>{session.label}</Button>)}
        </div>
        {!detail.run.members && <p className="text-xs text-muted-foreground">{t("Historical consultation: this version used one advisor.", "Историческая консультация: в этой версии работал один советник.")}</p>}
        {selectedSession?.workerId ? <div className="h-[58vh] min-h-0 overflow-hidden rounded-lg border border-border">
          <ThreadChat threadId={selectedSession.workerId} variant="timeline" layout="contained" />
        </div> : <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <Bubble title={t("You → MoA", "Вы → MoA")} body={detail.userInput || t("Message with attachments", "Сообщение с вложениями")} user />
          {members.map(({ member, input, inputVerified }) => <section key={member.key} className="space-y-3">
            <article className="mr-auto max-w-[95%] rounded-xl border border-border bg-card p-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">MoA → {member.key.toUpperCase()} · {member.advisor.model}</p>
              <p className="text-sm">{inputVerified ? t("Found in the advisor's actual outgoing request.", "Найдено в реальном запросе к советнику.") : input ? t("Prepared by MoA; submission is not yet confirmed in the event log.", "Подготовлено MoA; отправка ещё не подтверждена журналом событий.") : t("No saved request found.", "Сохранённый запрос не найден.")}</p>
              {member.primaryAdvisor && <p className="mt-2 text-xs text-muted-foreground">{t("Reserve replaced", "Резерв заменил")} {member.primaryAdvisor.model}. {member.attempts?.map(attempt => attempt.error ?? t("Stopped by user", "Остановлен пользователем")).join(" ")}</p>}
              {member.progress && <p className="mt-2 text-xs text-muted-foreground">BB: {member.progress.state} · {new Date(member.progress.observedAt).toLocaleTimeString()}</p>}
              {detail.canReplace && detail.run.status === "running" && member.status === "running" && !member.primaryAdvisor && <Button className="mt-2" size="sm" variant="outline" disabled={!!replacing} onClick={() => void replace(member.key)}>{t("Stop this participant and start reserve", "Остановить этого участника и запустить резерв")}</Button>}
              {input && <details className="mt-3 text-sm"><summary className="cursor-pointer">{t("Request, context and instructions", "Запрос, контекст и инструкции")}</summary><Markdown className="mt-3 text-sm" content={readablePayload(input)} /></details>}
            </article>
            {member.advice ? <Bubble title={`${member.key.toUpperCase()} · ${member.advisor.model} → ${t("acting model", "основная модель")}`} body={member.advice} /> : <p className="text-sm text-muted-foreground">{member.error ?? t("The advisor has not returned a final answer yet.", "Советник ещё не вернул готовый ответ.")}</p>}
          </section>)}
          <article className="ml-auto max-w-[95%] rounded-xl border border-border bg-muted p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t("What the acting model received", "Что получила основная модель")}</p>
            <p className="text-sm">{detail.mainInputVerified ? t("Your message and the complete advisor reference above are present in BB's actual outgoing request.", "В реальном исходящем запросе BB есть ваше сообщение и весь приведённый выше совет.") : t("No outgoing request containing this advice has been found. Ready advice alone does not confirm delivery.", "Исходящий запрос с этим советом пока не найден. Готовность совета сама по себе не подтверждает передачу.")}</p>
            {detail.mainRequestedAt && <p className="mt-2 text-xs text-muted-foreground">{new Date(detail.mainRequestedAt).toLocaleString()}</p>}
            {detail.mainInput && <details className="mt-3 text-sm"><summary className="cursor-pointer">{t("Show the complete message payload", "Показать полный состав сообщения")}</summary><Markdown className="mt-3 text-sm" content={readablePayload(detail.mainInput)} /></details>}
          </article>
        </div>}
      </>}
    </DialogContent>
  </Dialog>;
}
