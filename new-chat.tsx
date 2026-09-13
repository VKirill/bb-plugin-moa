import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useComposer, useComposerView, useRpc, useRealtime, useRealtimeConnectionState, experimental_ProviderModelPicker as ModelPicker } from "@get-bb/plugin-sdk/app";
import type { Config, rpcContract } from "./contract";
import { FallbackSettings, invalidFallback } from "./fallback";
import { getDraft, subscribeDraft, moaMentions, removeMoa } from "./draft";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
const ru = typeof navigator !== "undefined" && navigator.languages.some(l => l.startsWith("ru"));
const t = (en: string, russian: string) => ru ? russian : en;

export function NewChatMoA() {
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
      } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : "Could not load MoA."); }
    })();
    return () => { live = false; };
  }, [projectId, token, rpc, sharedRevision, connection]);
  useEffect(() => { setOpen(false); }, [projectId]);
  function remove() {
    composer.updateText(text => removeMoa(text, getDraft().draft));
  }
  async function save() {
    if (!projectId || !config) return;
    setBusy(true); setError(null);
    try {
      const selection = await rpc.call("prepareDraft", { projectId, config: { ...config, enabled: true } });
      // Refuse a stale response after switching projects or changing this draft.
      if (!mounted.current || currentProject.current !== projectId) throw new Error("The draft changed. Choose MoA again.");
      if (moaMentions(getDraft().draft).length) {
        remove();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      if (!mounted.current || currentProject.current !== projectId) return;
      composer.insertMention({ provider: "draft", id: selection.token, label: "MoA" });
      setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save MoA."); }
    finally { setBusy(false); }
  }
  function toggle(on: boolean) {
    setError(null);
    if (on) { setOpen(true); return; }
    try { remove(); } catch (cause) { setError((cause as Error).message); }
  }
  const same = config && config.a.providerId === config.b.providerId && config.a.model === config.b.model;
  return <div className="flex items-center gap-1">
    <label className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1.5 text-xs" title={t("Use MoA starting with the first message", "MoA с первого сообщения")}>
      <Checkbox aria-label="MoA" className="size-3 [&_svg]:size-2.5" checked={!!token}
        disabled={!projectId || busy || view.run.isSubmitting} onCheckedChange={value => toggle(value === true)} />
      <span>MoA</span>
    </label>
    <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t("MoA settings", "Настройки MoA")}
      disabled={!projectId || busy || view.run.isSubmitting} onClick={() => setOpen(true)}><Icon name="Settings" className="size-3.5" /></Button>
    {error && !open && <span role="alert" className="max-w-48 truncate text-xs text-destructive" title={error}>{error}</span>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mixture of Agents</DialogTitle>
          <DialogDescription>{t("Enable MoA before the first message. Both participants advise independently; your current chat model acts and answers.", "Включи MoA до первого сообщения. Оба участника сначала дают независимые советы, затем модель чата выполняет работу и отвечает.")}</DialogDescription>
        </DialogHeader>
        {config && hostId ? <>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["a", "b"] as const).map(key => <div key={key} className="rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-medium">{t("Participant", "Участник")} {key.toUpperCase()}</p>
              <ModelPicker routing={{ kind: "host", hostId }} value={config[key]}
                onChange={slot => setConfig({ ...config, [key]: { ...slot, agentId: null } })} />
            </div>)}
          </div>
          <p className="text-sm text-muted-foreground">{t("Both A and B analyze every request independently. Models and fallback settings are shared across all chats and projects; enabling MoA applies only to this draft.", "A и B независимо анализируют каждый запрос. Модели и настройки фоллбека общие для всех чатов и проектов; включение MoA относится только к этому черновику.")}</p>
          <FallbackSettings config={config} onChange={setConfig} picker={<ModelPicker routing={{ kind: "host", hostId }} value={config.reserve ?? config.a} onChange={slot => setConfig({ ...config, reserve: { ...slot, agentId: null } })} />} />
          {same && <p className="text-sm text-destructive">{t("Choose two different models.", "Выбери две разные модели.")}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t("Cancel", "Отмена")}</Button>
            <Button disabled={busy || !!same || invalidFallback(config) || view.run.isSubmitting} onClick={() => void save()}>{t("Enable for this chat", "Включить для этого чата")}</Button>
          </div>
        </> : !error && <p className="text-sm text-muted-foreground">{t("Loading models…", "Загрузка моделей…")}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  </div>;
}
