import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useComposer, useComposerView, useRpc, useRealtime, useRealtimeConnectionState, experimental_ProviderModelPicker as ModelPicker } from "@get-bb/plugin-sdk/app";
import type { Config, rpcContract } from "./contract";
import { FallbackSettings, invalidFallback } from "./fallback";
import { getDraft, subscribeDraft, moaMentions, removeMoa } from "./draft";
import { Button } from "@/components/ui/button";
import { MoAComposerToggle } from "./composer-toggle";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { t, useLocale } from "./i18n";

export function NewChatMoA() {
  useLocale();
  const view = useComposerView();
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const projectId = view.scope.kind === "new-thread" ? view.scope.projectId : null;
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const observed = useSyncExternalStore(subscribeDraft, getDraft);
  const token = observed.projectId === projectId ? moaMentions(observed.draft)[0]?.id : undefined;
  const [config, setConfig] = useState<Config | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharedRevision, setSharedRevision] = useState(0);
  const connection = useRealtimeConnectionState();
  useRealtime("changed", payload => {
    if (payload && typeof payload === "object" && "global" in payload && payload.global) setSharedRevision(value => value + 1);
  });
  useEffect(() => {
    let live = true;
    setConfig(null); setHostId(null); setError(null);
    if (projectId) void (async () => {
      try {
        const defaults = await rpc.call("draftDefaults", { projectId });
        const selected = token ? await rpc.call("readDraft", { token }) : defaults.config;
        if (live) { setConfig(selected); setHostId(defaults.hostId); }
      } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : t("loadFailed")); }
    })();
    return () => { live = false; };
  }, [projectId, token, rpc, sharedRevision, connection]);
  const previousProject = useRef(projectId);
  useEffect(() => {
    if (previousProject.current !== projectId) {
      if (previousProject.current != null) setOpen(false);
      previousProject.current = projectId;
    }
  }, [projectId]);
  function remove() {
    composer.updateText(text => removeMoa(text, getDraft().draft));
  }
  async function save() {
    if (!projectId || !config) return;
    setBusy(true); setError(null);
    try {
      const selection = await rpc.call("prepareDraft", { projectId, config: { ...config, enabled: true } });
      if (!mounted.current || currentProject.current !== projectId) throw new Error(t("draftChanged"));
      if (moaMentions(getDraft().draft).length) {
        remove();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      if (!mounted.current || currentProject.current !== projectId) return;
      composer.insertMention({ provider: "draft", id: selection.token, label: "MoA" });
      setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("saveFailed")); }
    finally { setBusy(false); }
  }
  return <div className="flex items-center">
    <span title={t("chipTitleNew")} className="inline-flex">
      <Dialog open={open} onOpenChange={next => { setOpen(next); setError(null); }}>
        <DialogTrigger asChild>
          <MoAComposerToggle
            pressed={!!token}
            disabled={!projectId || view.run.isSubmitting}
            menuLabel={t("chipMenuNew")}
          />
        </DialogTrigger>
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
          onOpenAutoFocus={event => event.preventDefault()}
          onCloseAutoFocus={event => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t("pluginTitle")}</DialogTitle>
            <DialogDescription>{t("newChatDescription")}</DialogDescription>
          </DialogHeader>
          {config && hostId ? <>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["a", "b"] as const).map(key => <div key={key} className="rounded-lg border border-border p-3">
                <p className="mb-2 text-sm font-medium">{t("participant")} {key.toUpperCase()}</p>
                <ModelPicker routing={{ kind: "host", hostId }} value={config[key]}
                  onChange={slot => setConfig({ ...config, [key]: { ...slot, agentId: null } })} />
              </div>)}
            </div>
            <p className="text-sm text-muted-foreground">{t("newChatSharedHint")}</p>
            <FallbackSettings config={config} onChange={setConfig} picker={<ModelPicker routing={{ kind: "host", hostId }} value={config.reserve ?? config.a} onChange={slot => setConfig({ ...config, reserve: { ...slot, agentId: null } })} />} />
            {config.a.providerId === config.b.providerId && config.a.model === config.b.model && <p className="text-sm text-destructive">{t("chooseDifferent")}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
              <Button disabled={busy || (config.a.providerId === config.b.providerId && config.a.model === config.b.model) || invalidFallback(config) || view.run.isSubmitting} onClick={() => void save()}>{t("enableForChat")}</Button>
            </div>
          </> : !error && <p className="text-sm text-muted-foreground">{t("loadingModels")}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </DialogContent>
      </Dialog>
    </span>
    {error && !open && <span role="alert" className="max-w-48 truncate text-xs text-destructive" title={error}>{error}</span>}
  </div>;
}
