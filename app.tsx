import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useComposerView, useRealtime, useRealtimeConnectionState, useRpc, useBbNavigate,
  experimental_ProviderModelPicker as ModelPicker } from "@get-bb/plugin-sdk/app";
import type { Config, RunView, Slot, rpcContract } from "./contract";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { NewChatMoA } from "./new-chat";
import { observeDraft } from "./draft";

const ru = typeof navigator !== "undefined" && navigator.languages.some(l => l.startsWith("ru"));
const t = (en: string, russian: string) => ru ? russian : en;
type Status = { config: Config | null; main: Slot; environmentId: string | null; runs: RunView[] };
const same = (a: Slot, b: Slot) => a.providerId === b.providerId && a.model === b.model;
function SlotEditor({ label, slot, onChange, threadId, environmentId }: {
  label: string; slot: Slot; onChange: (slot: Slot) => void; threadId: string; environmentId: string;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [agents, setAgents] = useState<{ id: string; description: string }[]>([]);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let live = true;
    setAgents([]); setSupported(false);
    rpc.call("agents", { threadId, providerId: slot.providerId }).then(result => {
      if (live) { setAgents(result.agents); setSupported(result.supported); }
    }).catch(() => {});
    return () => { live = false; };
  }, [rpc, threadId, slot.providerId]);
  return <div className="rounded-lg border border-border bg-card p-3">
    <p className="mb-2 text-sm font-medium">{label}</p>
    <ModelPicker value={slot} routing={{ kind: "environment", environmentId }} onChange={value =>
      onChange({ ...value, agentId: value.providerId === slot.providerId ? slot.agentId : null })} />
    <label className="mt-3 block text-xs text-muted-foreground">
      {t("Native agent / profile", "Нативный агент / профиль")}
      <select className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm text-foreground"
        aria-label={`${label} ${t("agent", "агент")}`} disabled={!supported}
        value={slot.agentId ?? ""} onChange={e => onChange({ ...slot, agentId: e.target.value || null })}>
        <option value="">{t("Default agent", "Обычный агент")}</option>
        {agents.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
      </select>
    </label>
    {!supported && <p className="mt-1 text-xs text-muted-foreground">{t("Optional: CLI Agents plugin", "Опционально: плагин CLI Agents")}</p>}
  </div>;
}
function RunHistory({ runs, retry }: { runs: RunView[]; retry: (id: string) => void }) {
  const navigate = useBbNavigate();
  const labels: Record<RunView["status"], string> = {
    waiting: t("Waiting", "Ожидание"), running: t("Consulting", "Консультация"), ready: t("Ready", "Готово"),
    dispatched: t("Delivered", "Передано агенту"), failed: t("Failed", "Ошибка"),
    cancelled: t("Cancelled", "Отменено"), bypassed: t("Sent without advice", "Отправлено без совета"),
  };
  return <div className="space-y-2">
    {runs.length === 0 && <p className="text-sm text-muted-foreground">{t("Consultations will appear here.", "Здесь появится история консультаций.")}</p>}
    {runs.map(run => <details key={run.id} className="rounded-md border border-border p-3 text-sm">
      <summary className="cursor-pointer">{labels[run.status]} · {run.advisor.model} → {run.aggregator.model}</summary>
      <p className="mt-2 text-xs text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</p>
      {run.error && <p role="alert" className="mt-2 text-destructive">{run.error}</p>}
      {run.advice && <p className="mt-2 whitespace-pre-wrap break-words">{run.advice}</p>}
      <div className="mt-2 flex gap-2">
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
  useEffect(() => { setState(null); setOpen(false); setError(null); void refresh(); }, [refresh]);
  useEffect(() => { if (connection === "connected") void refresh(); }, [connection, refresh]);
  useRealtime("changed", payload => {
    if (payload && typeof payload === "object" && "threadId" in payload && payload.threadId === threadId) void refresh();
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
  return <div className="flex items-center gap-1">
    <label className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1.5 text-xs" title={t("Consult a second model before every message", "Совет второй модели перед каждым сообщением")}>
      <Checkbox aria-label="MoA" className="size-3 [&_svg]:size-2.5" checked={state?.config?.enabled ?? false} disabled={!state || busy}
        onCheckedChange={checked => void toggle(checked === true)} />
      <span>MoA</span>
      {consulting && <Icon name="Spinner" className="size-3 animate-spin" />}
    </label>
    <Button type="button" variant="ghost" size="icon" className="size-7" disabled={!state}
      aria-label={t("MoA settings and history", "Настройки и история MoA")} onClick={() => settings()}>
      <Icon name={latest?.status === "failed" ? "AlertCircle" : "Settings"} className="size-3.5" />
    </Button>
    {error && !open && <span role="alert" className="max-w-48 truncate text-xs text-destructive" title={error}>{error}</span>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mixture of Agents</DialogTitle>
          <DialogDescription>{t("The current chat model acts and answers. The other member of the pair advises first.", "Модель текущего чата действует и отвечает. Второй участник пары сначала даёт совет.")}</DialogDescription>
        </DialogHeader>
        {draft && state?.environmentId && <>
          <div className="grid gap-3 sm:grid-cols-2">
            <SlotEditor label={t("Participant A", "Участник A")} slot={draft.a} onChange={a => setDraft({ ...draft, a })} threadId={threadId} environmentId={state.environmentId} />
            <SlotEditor label={t("Participant B", "Участник B")} slot={draft.b} onChange={b => setDraft({ ...draft, b })} threadId={threadId} environmentId={state.environmentId} />
          </div>
          <p className="text-sm text-muted-foreground">{t("If the chat uses B, A advises. Otherwise B advises. Advisor history is kept for this chat.", "Если в чате выбрана B, советует A. В остальных случаях советует B. История советника сохраняется для этого чата.")}</p>
          {same(draft.a, draft.b) && <p className="text-sm text-destructive">{t("Choose two different models.", "Выбери две разные модели.")}</p>}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={draft.enabled} onCheckedChange={enabled => setDraft({ ...draft, enabled: enabled === true })} />
            {t("Enable MoA for this chat", "Включить MoA для этого чата")}
          </label>
          <label className="flex items-center gap-3 text-sm">{t("Advisor timeout (seconds)", "Ожидание советника (секунд)")}
            <input type="number" min={30} max={900} className="w-24 rounded-md border border-input bg-background p-2"
              value={draft.timeoutSeconds} onChange={e => setDraft({ ...draft, timeoutSeconds: Number(e.target.value) })} />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t("Close", "Закрыть")}</Button>
            <Button disabled={busy || same(draft.a, draft.b)} onClick={() => void save()}>{t("Save", "Сохранить")}</Button>
          </div>
        </>}
        <div className="border-t border-border pt-4">
          <p className="mb-3 font-medium">{t("Consultation history", "История консультаций")}</p>
          <RunHistory runs={state?.runs ?? []} retry={id => { void rpc.call("retry", { threadId, runId: id }).then(refresh).catch(report); }} />
        </div>
        <p className="text-xs text-muted-foreground">{t("BB’s explicit “Send now” overrides the wait and sends without advice. If a consultation fails, retry here or turn MoA off. Disabling the plugin also releases waiting messages.", "Штатная команда BB «Отправить сейчас» отменяет ожидание и отправляет без совета. При ошибке повтори консультацию здесь или выключи MoA. Отключение самого плагина тоже освобождает ожидающие сообщения.")}</p>
      </DialogContent>
    </Dialog>
  </div>;
}
export default definePluginApp(app => {
  app.composer.customize({ id: "moa", scopes: ["thread", "new-thread"], actions: [{ id: "toggle", component: ComposerMoA }],
    banners: [{ id: "compact-toggle", chrome: "bare", component: CompactControl }], richText: { onDraftChange: observeDraft } });
});
function ComposerMoA() {
  const view = useComposerView();
  return view.scope.kind === "new-thread" ? <NewChatMoA /> : <MoAControl />;
}
function CompactControl() {
  const { layout } = useComposerView();
  return layout === "compact" ? <ComposerMoA /> : null;
}
