import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown, definePluginApp, useComposerView, useRealtime, useRealtimeConnectionState, useRpc, useBbNavigate,
  experimental_ProviderModelPicker as ModelPicker } from "@get-bb/plugin-sdk/app";
import type { Config, RunView, Slot, rpcContract } from "./contract";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FallbackSettings, invalidFallback } from "./fallback";
import { NewChatMoA } from "./new-chat";
import { MoAComposerToggle } from "./composer-toggle";
import { observeDraft } from "./draft";
import { HistoryOverlay, HISTORY_TITLE, showAudit, openMessageAudit, mountHistoryVisibility } from "./history";

const ru = typeof navigator !== "undefined" && navigator.languages.some(l => l.startsWith("ru"));
const t = (en: string, russian: string) => ru ? russian : en;
type Status = { config: Config | null; main: Slot; environmentId: string | null; runs: RunView[] };
const same = (a: Slot, b: Slot) => a.providerId === b.providerId && a.model === b.model;
function SlotEditor({ label, slot, onChange, threadId, environmentId }: {
  label: string; slot: Slot; onChange: (slot: Slot) => void; threadId: string; environmentId: string;
}) {
  return <div className="rounded-lg border border-border bg-card p-3">
    <p className="mb-2 text-sm font-medium">{label}</p>
    <ModelPicker value={slot} routing={{ kind: "environment", environmentId }} onChange={value =>
      onChange({ ...value, agentId: null })} />

  </div>;
}
function RunHistory({ runs, retry, view }: { runs: RunView[]; retry: (id: string) => void; view: (run: RunView) => void }) {
  const navigate = useBbNavigate();
  const labels: Record<RunView["status"], string> = {
    waiting: t("Waiting", "Ожидание"), running: t("Consulting", "Консультация"), ready: t("Ready", "Готово"),
    dispatched: t("Delivered", "Передано агенту"), failed: t("Failed", "Ошибка"),
    cancelled: t("Cancelled", "Отменено"), bypassed: t("Sent without advice", "Отправлено без совета"),
  };
  return <div className="space-y-2">
    {runs.length === 0 && <p className="text-sm text-muted-foreground">{t("Consultations will appear here.", "Здесь появится история консультаций.")}</p>}
    {runs.map(run => <details key={run.id} className="rounded-md border border-border p-3 text-sm">
      <summary className="cursor-pointer">{labels[run.status]} · {run.members?.map(m => m.advisor.model).join(" + ") ?? run.advisor.model} → {run.aggregator.model}</summary>
      <p className="mt-2 text-xs text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</p>
      {run.status === "running" && run.progress && <p className="mt-2 text-xs text-muted-foreground">
        {t("BB state", "Состояние BB")}: {run.progress.state} · {Math.floor((run.progress.observedAt - run.startedAt) / 1000)} {t("seconds", "секунд")}.
        {run.progress.lastEventAt && <> {t("Latest event", "Последнее событие")}: {new Date(run.progress.lastEventAt).toLocaleTimeString()}.</>}
        {run.progress.overdue && <> {t("Taking longer than the notification threshold. MoA continues waiting; the advisor is not stopped by this timer.", "Превышен порог уведомления. MoA продолжает ждать; этот таймер не останавливает советника.")}</>}
      </p>}
      {run.error && <p role="alert" className="mt-2 text-destructive">{run.error}</p>}
      {run.advice && <Markdown className="mt-3 text-sm" content={run.advice} />}
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" onClick={() => view(run)}>{t("View consultation", "Открыть консультацию")}</Button>
        {run.status === "failed" && <Button size="sm" variant="outline" onClick={() => retry(run.id)}>{t("Retry", "Повторить")}</Button>}
        {run.workerId && <Button size="sm" variant="ghost" onClick={() => navigate.toThread(run.workerId!)}>{t("Advisor history", "История советника")}</Button>}
      </div>
    </details>)}
  </div>;
}
export function MoAControl() {
  const view = useComposerView();
  const threadId = view.scope.kind === "thread" || view.scope.kind === "queued-message" ? view.scope.threadId : null;
  const currentThread = useRef(threadId);
  currentThread.current = threadId;
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [state, setState] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const report = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : t("Request failed", "Ошибка запроса")), []);
  const refresh = useCallback(async () => {
    if (!threadId) return;
    try {
      const next = await rpc.call("status", { threadId });
      if (currentThread.current === threadId) setState(next);
    } catch (cause) { if (currentThread.current === threadId) report(cause); }
  }, [threadId, rpc, report]);
  useEffect(() => { setState(null); setOpen(false); setError(null); void refresh(); }, [threadId]);
  useEffect(() => { if (connection === "connected") void refresh(); }, [connection, refresh]);
  useRealtime("changed", payload => {
    if (payload && typeof payload === "object" && (("global" in payload && payload.global) || ("threadId" in payload && payload.threadId === threadId))) void refresh();
  });
  function settings(enable = false) {
    if (!state) return;
    setDraft(state.config ? { ...state.config, enabled: enable || state.config.enabled } : {
      a: state.main, b: { ...state.main, agentId: null }, enabled: enable, timeoutSeconds: 240,
    });
    setError(null); setOpen(true);
  }
  async function toggle(enabled: boolean) {
    if (!threadId || !state) return;
    if (!state.config) return settings(enabled);
    setBusy(true); setError(null);
    try { await rpc.call("toggle", { threadId, enabled }); await refresh(); } catch (cause) { report(cause); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!draft || !threadId) return;
    setBusy(true); setError(null);
    try { await rpc.call("save", { threadId, config: draft }); await refresh(); setOpen(false); }
    catch (cause) { report(cause); } finally { setBusy(false); }
  }
  if (!threadId) return null;
  const latest = state?.runs[0];
  const consulting = state?.config?.enabled && (latest?.status === "running" || latest?.status === "waiting");
  return <div className="flex items-center">
    <MoAComposerToggle
      pressed={state?.config?.enabled ?? false}
      disabled={!state || busy}
      title={t("Consult both participants before every message", "Совет двух участников перед каждым сообщением")}
      menuLabel={t("MoA settings and history", "Настройки и история MoA")}
      onToggle={enabled => void toggle(enabled)}
      onOpenMenu={() => settings()}
      menuFailed={latest?.status === "failed"}
      open={open}
      trailing={<>
        {consulting && <Icon name="Spinner" className="size-3 animate-spin" />}
        {consulting && latest?.progress?.overdue && <span className="text-muted-foreground" title={t("Long consultation: open settings for the advisor's state and history", "Долгая консультация: состояние и история советника доступны в настройках")}>{t("Waiting", "Ожидаем")}</span>}
      </>}
    />
    {error && !open && <span role="alert" className="max-w-48 truncate text-xs text-destructive" title={error}>{error}</span>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mixture of Agents</DialogTitle>
          <DialogDescription>{t("Both participants independently analyze the request. The current chat model receives both answers, acts and replies.", "Оба участника независимо анализируют запрос. Модель текущего чата получает оба ответа, выполняет работу и отвечает.")}</DialogDescription>
        </DialogHeader>
        {draft && state?.environmentId && <>
          <div className="grid gap-3 sm:grid-cols-2">
            <SlotEditor label={t("Participant A", "Участник A")} slot={draft.a} onChange={a => setDraft({ ...draft, a })} threadId={threadId} environmentId={state.environmentId} />
            <SlotEditor label={t("Participant B", "Участник B")} slot={draft.b} onChange={b => setDraft({ ...draft, b })} threadId={threadId} environmentId={state.environmentId} />
          </div>
          <p className="text-sm text-muted-foreground">{t("A and B each have a separate advisor session for this chat. The current chat model aggregates both answers.", "У A и B отдельные сессии советников для этого чата. Модель текущего чата объединяет оба ответа.")}</p>
          <p className="text-sm text-muted-foreground">{t("Models and fallback settings are shared across all chats and projects. Enabling MoA applies only to this chat.", "Модели и настройки фоллбека общие для всех чатов и проектов. Включение MoA относится только к этому чату.")}</p>
          {same(draft.a, draft.b) && <p className="text-sm text-destructive">{t("Choose two different models.", "Выбери две разные модели.")}</p>}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={draft.enabled} onCheckedChange={enabled => setDraft({ ...draft, enabled: enabled === true })} />
            {t("Enable MoA for this chat", "Включить MoA для этого чата")}
          </label>
          <label className="flex items-center gap-3 text-sm">{t("Long-wait notice after (seconds)", "Сообщить о долгом ожидании через (секунд)")}
            <input type="number" min={30} max={900} className="w-24 rounded-md border border-input bg-background p-2"
              value={draft.timeoutSeconds} onChange={e => setDraft({ ...draft, timeoutSeconds: Number(e.target.value) })} />
          </label>
          <p className="text-xs text-muted-foreground">{t("This is a notification threshold, not a time limit for an active model. MoA waits for completion or an explicit BB error. You can cancel the queued message or turn MoA off.", "Это порог уведомления, а не ограничение работы активной модели. MoA ждёт завершения или явной ошибки BB. Можно отменить сообщение в очереди или выключить MoA.")}</p>
          <FallbackSettings config={draft} onChange={setDraft} picker={<SlotEditor label={t("Backup participant", "Резервный участник")} slot={draft.reserve ?? state.main} onChange={reserve => setDraft({ ...draft, reserve })} threadId={threadId} environmentId={state.environmentId} />} />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t("Close", "Закрыть")}</Button>
            <Button disabled={busy || same(draft.a, draft.b) || invalidFallback(draft)} onClick={() => void save()}>{t("Save", "Сохранить")}</Button>
          </div>
        </>}
        <div className="border-t border-border pt-4">
          <p className="mb-3 font-medium">{t("Consultation history", "История консультаций")}</p>
          <RunHistory runs={state?.runs ?? []} view={run => { setOpen(false); showAudit({ threadId, runId: run.id }); }} retry={id => { void rpc.call("retry", { threadId, runId: id }).then(refresh).catch(report); }} />
        </div>
        <p className="text-xs text-muted-foreground">{t("BB’s explicit “Send now” overrides the wait and sends without advice. If a consultation fails, retry here or turn MoA off. Disabling the plugin also releases waiting messages.", "Штатная команда BB «Отправить сейчас» отменяет ожидание и отправляет без совета. При ошибке повтори консультацию здесь или выключи MoA. Отключение самого плагина тоже освобождает ожидающие сообщения.")}</p>
      </DialogContent>
    </Dialog>
  </div>;
}
export default definePluginApp(app => {
  app.slots.messageAction({ id: "consultation-history", title: HISTORY_TITLE, icon: "Workflow",
    run: ({ threadId, message }) => openMessageAudit(threadId, message.id) });
  app.slots.experimental_appOverlay({ id: "consultation-history", component: HistoryOverlay });
  app.contentScripts.register({ id: "message-history-visibility", mount: mountHistoryVisibility });
  app.contentScripts.register({ id: "hide-draft-marker", mount() {
    const style = document.createElement("style");
    style.dataset.bbMoa = "draft-marker";
    const chip = `[data-prompt-mention-resource*='"pluginId":"moa"'][data-prompt-mention-resource*='"itemId":"draft:']`;
    style.textContent = `${chip}, .node-mention:has(> ${chip}) { display: none !important; }`;
    document.head.append(style);
    return () => style.remove();
  } });
  app.composer.customize({ id: "moa", scopes: ["thread", "new-thread"], actions: [{ id: "toggle", component: ComposerMoA }],
    richText: { onDraftChange: observeDraft } });
});
function ComposerMoA() {
  const view = useComposerView();
  return view.scope.kind === "new-thread" ? <NewChatMoA /> : <MoAControl />;
}
