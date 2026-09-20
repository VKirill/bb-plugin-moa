import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown, definePluginApp, useComposerView, useRealtime, useRealtimeConnectionState, useRpc, useBbNavigate,
  experimental_ProviderModelPicker as ModelPicker } from "@get-bb/plugin-sdk/app";
import type { Config, RunView, Slot, rpcContract } from "./contract";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FallbackSettings, invalidFallback } from "./fallback";
import { NewChatMoA } from "./new-chat";
import { MoAComposerToggle } from "./composer-toggle";
import { observeDraft } from "./draft";
import { HistoryOverlay, HISTORY_TITLE, showAudit, openMessageAudit, mountHistoryVisibility } from "./history";
import { LanguageSettings } from "./settings";
import { t, useLocale } from "./i18n";

type Status = { config: Config | null; main: Slot; environmentId: string | null; runs: RunView[] };
const same = (a: Slot, b: Slot) => a.providerId === b.providerId && a.model === b.model;
function SlotEditor({ label, slot, onChange, environmentId }: {
  label: string; slot: Slot; onChange: (slot: Slot) => void; environmentId: string;
}) {
  return <div className="rounded-lg border border-border bg-card p-3">
    <p className="mb-2 text-sm font-medium">{label}</p>
    <ModelPicker value={slot} routing={{ kind: "environment", environmentId }} onChange={value =>
      onChange({ ...value, agentId: null })} />
  </div>;
}
function RunHistory({ runs, retry, view }: { runs: RunView[]; retry: (id: string) => void; view: (run: RunView) => void }) {
  useLocale();
  const navigate = useBbNavigate();
  const labels: Record<RunView["status"], string> = {
    waiting: t("waiting"), running: t("consulting"), ready: t("ready"),
    dispatched: t("delivered"), failed: t("failed"),
    cancelled: t("cancelled"), bypassed: t("bypassed"),
  };
  return <div className="space-y-2">
    {runs.length === 0 && <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>}
    {runs.map(run => <details key={run.id} className="rounded-md border border-border p-3 text-sm">
      <summary className="cursor-pointer">{labels[run.status]} · {run.members?.map(m => m.advisor.model).join(" + ") ?? run.advisor.model} → {run.aggregator.model}</summary>
      <p className="mt-2 text-xs text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</p>
      {run.status === "running" && run.progress && <p className="mt-2 text-xs text-muted-foreground">
        {t("bbState")}: {run.progress.state} · {Math.floor((run.progress.observedAt - run.startedAt) / 1000)} {t("seconds")}.
        {run.progress.lastEventAt && <> {t("latestEvent")}: {new Date(run.progress.lastEventAt).toLocaleTimeString()}.</>}
        {run.progress.overdue && <> {t("overdueHint")}</>}
      </p>}
      {run.error && <p role="alert" className="mt-2 text-destructive">{run.error}</p>}
      {run.advice && <Markdown className="mt-3 text-sm" content={run.advice} />}
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" onClick={() => view(run)}>{t("viewConsultation")}</Button>
        {run.status === "failed" && <Button size="sm" variant="outline" onClick={() => retry(run.id)}>{t("retry")}</Button>}
        {run.workerId && <Button size="sm" variant="ghost" onClick={() => navigate.toThread(run.workerId!)}>{t("advisorHistory")}</Button>}
      </div>
    </details>)}
  </div>;
}
function draftFrom(state: Status, enable = false): Config {
  return state.config ? { ...state.config, enabled: enable || state.config.enabled } : {
    a: state.main, b: { ...state.main, agentId: null }, enabled: enable, timeoutSeconds: 240,
  };
}
export function MoAControl() {
  useLocale();
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
  const report = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : t("requestFailed")), []);
  const refresh = useCallback(async () => {
    if (!threadId) return;
    try {
      const next = await rpc.call("status", { threadId });
      if (currentThread.current === threadId) setState(next);
    } catch (cause) { if (currentThread.current === threadId) report(cause); }
  }, [threadId, rpc, report]);
  useEffect(() => { setState(null); setOpen(false); setError(null); setDraft(null); void refresh(); }, [threadId]);
  useEffect(() => { if (connection === "connected") void refresh(); }, [connection, refresh]);
  useEffect(() => { if (open && state && !draft) setDraft(draftFrom(state)); }, [open, state, draft]);
  useRealtime("changed", payload => {
    if (payload && typeof payload === "object" && (("global" in payload && payload.global) || ("threadId" in payload && payload.threadId === threadId))) void refresh();
  });
  function onOpenChange(next: boolean) {
    setOpen(next);
    setError(null);
    if (next && state) setDraft(draftFrom(state));
  }
  async function toggle(enabled: boolean) {
    if (!threadId || !state?.config) return;
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
    <span title={t("chipTitle")} className="inline-flex">
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <MoAComposerToggle
            pressed={state?.config?.enabled ?? false}
            menuLabel={t("chipMenu")}
            menuFailed={latest?.status === "failed"}
            trailing={<>
              {consulting && <Icon name="Spinner" className="size-3 animate-spin" />}
              {consulting && latest?.progress?.overdue && <span className="text-muted-foreground" title={t("longWaitChipTitle")}>{t("longWaitChip")}</span>}
            </>}
          />
        </DialogTrigger>
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
          onOpenAutoFocus={event => event.preventDefault()}
          onCloseAutoFocus={event => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t("pluginTitle")}</DialogTitle>
            <DialogDescription>{t("dialogDescription")}</DialogDescription>
          </DialogHeader>
          {draft && state?.environmentId ? <>
            <div className="grid gap-3 sm:grid-cols-2">
              <SlotEditor label={t("participantA")} slot={draft.a} onChange={a => setDraft({ ...draft, a })} environmentId={state.environmentId} />
              <SlotEditor label={t("participantB")} slot={draft.b} onChange={b => setDraft({ ...draft, b })} environmentId={state.environmentId} />
            </div>
            <p className="text-sm text-muted-foreground">{t("sessionsHint")}</p>
            <p className="text-sm text-muted-foreground">{t("sharedHint")}</p>
            {same(draft.a, draft.b) && <p className="text-sm text-destructive">{t("chooseDifferent")}</p>}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={draft.enabled} onCheckedChange={enabled => {
                const next = enabled === true;
                setDraft({ ...draft, enabled: next });
                if (state.config) void toggle(next);
              }} />
              {t("enableChat")}
            </label>
            <label className="flex items-center gap-3 text-sm">{t("longWaitLabel")}
              <input type="number" min={30} max={900} className="w-24 rounded-md border border-input bg-background p-2"
                value={draft.timeoutSeconds} onChange={e => setDraft({ ...draft, timeoutSeconds: Number(e.target.value) })} />
            </label>
            <p className="text-xs text-muted-foreground">{t("longWaitHelp")}</p>
            <FallbackSettings config={draft} onChange={setDraft} picker={<SlotEditor label={t("backupParticipant")} slot={draft.reserve ?? state.main} onChange={reserve => setDraft({ ...draft, reserve })} environmentId={state.environmentId} />} />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>{t("close")}</Button>
              <Button disabled={busy || same(draft.a, draft.b) || invalidFallback(draft)} onClick={() => void save()}>{t("save")}</Button>
            </div>
          </> : !error && <p className="text-sm text-muted-foreground">{t("loadingModels")}</p>}
          {error && !draft && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="border-t border-border pt-4">
            <p className="mb-3 font-medium">{t("consultationHistory")}</p>
            <RunHistory runs={state?.runs ?? []} view={run => { setOpen(false); showAudit({ threadId, runId: run.id }); }} retry={id => { void rpc.call("retry", { threadId, runId: id }).then(refresh).catch(report); }} />
          </div>
          <p className="text-xs text-muted-foreground">{t("sendNowHint")}</p>
        </DialogContent>
      </Dialog>
    </span>
    {error && !open && <span role="alert" className="max-w-48 truncate text-xs text-destructive" title={error}>{error}</span>}
  </div>;
}
export default definePluginApp(app => {
  app.slots.settingsSection({
    id: "language",
    title: t("settingsTitle"),
    description: t("settingsHint"),
    component: LanguageSettings,
  });
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
