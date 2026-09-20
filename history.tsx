import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Markdown, ThreadChat, useBbContext, useRpc, useRealtime, useRealtimeConnectionState,
  experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";
import type { Audit, Slot, rpcContract } from "./contract";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { HISTORY_TITLE, HISTORY_TITLES, t, useLocale } from "./i18n";

export function readablePayload(text: string) {
  return text.split("\n").map(line => {
    if (/^\[bb-moa-reference:/.test(line)) return "";
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.advice === "string") return parsed.advice;
      if (Array.isArray(parsed.advisors)) return parsed.advisors.map((a: { model?: string; advice?: string }) => `### ${a.model ?? "Advisor"}\n\n${a.advice ?? ""}`).join("\n\n");
    } catch { /* Ordinary text is preserved. */ }
    if (line.startsWith("Canonical conversation updates")) return t("sharedConversation");
    if (line === "Current user request:") return t("currentRequest");
    return line;
  }).join("\n");
}
export { HISTORY_TITLE };
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
    const button = HISTORY_TITLES.map(label => `button[aria-label=${JSON.stringify(label)}]`).join(", ");
    const rows = [...indexes.values()].flat().filter(row => /^[\w:-]+$/.test(row.rowId));
    style.textContent = `${button} { display: none !important; }\n` + rows.map(row =>
      `[data-timeline-row-id="${row.rowId}"] :is(${button}) { display: inline-flex !important; }`).join("\n");
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
  useLocale();
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
    } catch (cause) { if (target === current) setError(cause instanceof Error ? cause.message : t("loadConsultationFailed")); }
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
    { id: `session-${i}`, workerId: member.workerId, label: members.length === 1 ? t("advisorSession") : `${t("session")} ${member.key.toUpperCase()} · ${member.advisor.model}` },
    ...(member.attempts ?? []).map((attempt, j) => ({ id: `attempt-${i}-${j}`, workerId: attempt.workerId, label: `${member.key.toUpperCase()} · ${attempt.advisor.model} (${t("priorAttempt")})` })),
  ]);
  const selectedSession = sessions.find(session => tab === session.id);
  const [replacing, setReplacing] = useState<string | null>(null);
  async function replace(key: "a" | "b") {
    if (!current) return;
    setReplacing(key); setError(null);
    try { await rpc.call("replaceParticipant", { ...current, key }); await refreshDetail(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("replacementFailed")); }
    finally { setReplacing(null); }
  }
  return <Dialog open={!!current} onOpenChange={open => { if (!open) showAudit(null); }}>
    <DialogContent className="flex max-h-[88vh] flex-col gap-3 sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle>{t("historyTitle")}</DialogTitle>
        <DialogDescription>{t("historyDescription")}</DialogDescription>
      </DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!detail && !error && <p className="text-sm text-muted-foreground">{t("loadingConsultation")}</p>}
      {detail && <>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {members.map(({ member }, i) => <span key={member.key} className="inline-flex items-center gap-1">{i > 0 && <span>+</span>}<ModelBadge slot={member.advisor} /></span>)}<span>→</span><ModelBadge slot={detail.run.aggregator} />
          <span className="text-muted-foreground">· {Math.round(((detail.run.finishedAt ?? Date.now()) - detail.run.startedAt) / 1000)} {t("s")}</span>
          {detail.run.partial && <span className="text-muted-foreground">{t("ofTwoFallback")}</span>}
          <span className="rounded-full bg-muted px-2 py-1">{detail.mainInputVerified ? t("deliveryConfirmed") : t("notDelivered")}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={tab === "message" ? "secondary" : "ghost"} onClick={() => setTab("message")}>{t("thisMessage")}</Button>
          {sessions.map(session => <Button key={session.id} size="sm" variant={tab === session.id ? "secondary" : "ghost"} disabled={!session.workerId} onClick={() => setTab(session.id)}>{session.label}</Button>)}
        </div>
        {!detail.run.members && <p className="text-xs text-muted-foreground">{t("historicalOne")}</p>}
        {selectedSession?.workerId ? <div className="h-[58vh] min-h-0 overflow-hidden rounded-lg border border-border">
          <ThreadChat threadId={selectedSession.workerId} variant="timeline" layout="contained" />
        </div> : <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <Bubble title={t("youToMoa")} body={detail.userInput || t("messageAttachments")} user />
          {members.map(({ member, input, inputVerified }) => <section key={member.key} className="space-y-3">
            <article className="mr-auto max-w-[95%] rounded-xl border border-border bg-card p-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">MoA → {member.key.toUpperCase()} · {member.advisor.model}</p>
              <p className="text-sm">{inputVerified ? t("foundOutgoing") : input ? t("preparedUnconfirmed") : t("noSavedRequest")}</p>
              {member.fileGateway !== undefined && <p className="mt-2 text-xs text-muted-foreground">{member.fileGateway ? t("gatewayAvailable") : t("gatewayUnavailable")}</p>}
              {member.primaryAdvisor && <p className="mt-2 text-xs text-muted-foreground">{t("reserveReplaced")} {member.primaryAdvisor.model}. {member.attempts?.map(attempt => attempt.error ?? t("stoppedByUser")).join(" ")}</p>}
              {member.progress && <p className="mt-2 text-xs text-muted-foreground">BB: {member.progress.state} · {new Date(member.progress.observedAt).toLocaleTimeString()}</p>}
              {detail.canReplace && detail.run.status === "running" && member.status === "running" && !member.primaryAdvisor && <Button className="mt-2" size="sm" variant="outline" disabled={!!replacing} onClick={() => void replace(member.key)}>{t("replaceParticipant")}</Button>}
              {input && <details className="mt-3 text-sm"><summary className="cursor-pointer">{t("requestContext")}</summary><Markdown className="mt-3 text-sm" content={readablePayload(input)} /></details>}
            </article>
            {member.advice ? <Bubble title={`${member.key.toUpperCase()} · ${member.advisor.model} → ${t("actingModel")}`} body={member.advice} /> : <p className="text-sm text-muted-foreground">{member.error ?? t("advisorPending")}</p>}
          </section>)}
          <article className="ml-auto max-w-[95%] rounded-xl border border-border bg-muted p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t("actingReceived")}</p>
            <p className="text-sm">{detail.mainInputVerified ? t("actingConfirmed") : t("actingMissing")}</p>
            {detail.mainRequestedAt && <p className="mt-2 text-xs text-muted-foreground">{new Date(detail.mainRequestedAt).toLocaleString()}</p>}
            {detail.mainInput && <details className="mt-3 text-sm"><summary className="cursor-pointer">{t("showPayload")}</summary><Markdown className="mt-3 text-sm" content={readablePayload(detail.mainInput)} /></details>}
          </article>
        </div>}
      </>}
    </DialogContent>
  </Dialog>;
}
