import { randomUUID } from "node:crypto";
import type { BbPluginApi, MessageDispatchHookContext } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { configSchema, rpcContract, runSchema, type Slot } from "./contract";
import { advisorFor, boundedContext, cleanInput, hash, runReference, sameModel, safeError, textOf, type Input } from "./core";
import { ADVISOR_PROMPT } from "./prompts";
import { createAudit } from "./audit";
import { createStore, type Run, type Session, type ThreadConfig, type DraftSelection, type Bootstrap, type SharedSettings, type Member } from "./store";

type Queue = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["queuedMessages"]["list"]>>[number];
const delay = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) return resolve();
  const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
  const timer = setTimeout(done, ms); signal.addEventListener("abort", done, { once: true });
});

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); resolve(null); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

export default function plugin(bb: BbPluginApi) {
  const store = createStore(bb);
  const audit = createAudit(bb, store);
  const active = new Map<string, { abort: AbortController; promise: Promise<void> }>();
  const memberControls = new Map<string, { abort: AbortController; replace: boolean }>();
  const shutdown = new AbortController();
  const localConfig = (threadId: string) => store.get<ThreadConfig>(`config:${threadId}`);
  const shared = () => store.get<SharedSettings>("global:settings");
  const configured = (threadId: string) => {
    const local = localConfig(threadId), global = shared();
    return global ? {
      config: configSchema.parse({ ...global.settings, enabled: local?.config.enabled ?? false }),
      revision: hash({ local: local?.revision ?? 0, global: global.revision }),
    } : local ? { ...local, config: configSchema.parse(local.config) } : null;
  };
  async function saveShared(config: ReturnType<typeof configSchema.parse>) {
    const { enabled: _, ...settings } = config;
    const old = shared();
    if (old && hash(old.settings) === hash(settings)) return;
    const pairChanged = !old || hash([old.settings.a, old.settings.b]) !== hash([settings.a, settings.b]);
    store.put("global:settings", "global", "settings", { settings, revision: (old?.revision ?? 0) + (pairChanged ? 1 : 0) });
    if (pairChanged) {
      for (const work of active.values()) work.abort.abort();
      for (const entry of await bb.sdk.threads.queue.list({ waitHolder: `plugin:${bb.pluginId}` })) await strip(entry).catch(() => {});
    }
    if (!shutdown.signal.aborted) bb.realtime.publish("changed", { global: true });
    await recheck();
  }
  const runFor = (queueId: string) => {
    const link = store.get<{ id: string }>(`queue:${queueId}`);
    return link ? store.get<Run>(`run:${link.id}`) : null;
  };
  function saveRun(run: Run) { store.put(`run:${run.id}`, run.threadId, "run", run); changed(run.threadId, run.status); }
  function changed(threadId: string, status?: Run["status"]) { if (!shutdown.signal.aborted) bb.realtime.publish("changed", { threadId, ...(status ? { status } : {}) }); }
  async function recheck() { if (!shutdown.signal.aborted) await bb.experimental_hooks.recheck("message.dispatch"); }
  const queue = (threadId: string) => bb.sdk.threads.queuedMessages.list({ threadId });
  async function mainSlot(threadId: string): Promise<Slot> {
    const thread = await bb.sdk.threads.get({ threadId });
    const execution = await bb.sdk.threads.defaultExecutionOptions({ threadId });
    if (!execution) {
      const pending = (await bb.sdk.threads.queuedMessages.list({ threadId }))[0];
      if (pending) return { providerId: thread.providerId, model: pending.model, reasoningLevel: pending.reasoningLevel, agentId: null };
      const boot = store.get<Bootstrap>(`bootstrap:${threadId}`);
      if (boot) return boot.main;
      throw new Error("Choose a model for this chat first.");
    }
    return { providerId: thread.providerId, model: execution.model, reasoningLevel: execution.reasoningLevel, agentId: null };
  }
  async function routing(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (!thread.environmentId) {
      const boot = store.get<Bootstrap>(`bootstrap:${threadId}`);
      if (!boot) throw new Error("The chat environment is not available yet.");
      const project = await bb.sdk.projects.get({ projectId: thread.projectId });
      const source = project.sources.find(s => s.hostId === boot.hostId);
      if (!source && project.kind !== "personal") throw new Error("A project workspace is not available on the selected machine.");
      return { thread, environment: { id: `bootstrap:${boot.hostId}`, hostId: boot.hostId }, bootstrap: true,
        spawnEnvironment: { type: "host" as const, hostId: boot.hostId, workspace: source
          ? { type: "unmanaged" as const, path: source.path }
          : { type: "personal" as const } } };
    }
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    return { thread, environment, bootstrap: false, spawnEnvironment: { type: "reuse" as const, environmentId: environment.id } };
  }
  function mainAt(ctx: MessageDispatchHookContext): Slot {
    return {
      providerId: ctx.requestedExecution.providerId,
      model: ctx.requestedExecution.model ?? "",
      reasoningLevel: ctx.requestedExecution.reasoningLevel ?? "medium", agentId: null,
    };
  }
  function fingerprint(input: readonly Input[number][], main: Slot, revision: number | string) {
    return hash({ input: cleanInput(input), provider: main.providerId, model: main.model, revision });
  }
  function current(run: Run, entry: Queue, main: Slot) {
    const cfg = configured(run.threadId);
    return !!cfg?.config.enabled && run.revision === cfg.revision
      && run.fingerprint === fingerprint(entry.content, main, cfg.revision);
  }
  async function strip(entry: Queue) {
    const input = cleanInput(entry.content);
    if (input.length !== entry.content.length) {
      await bb.sdk.threads.queuedMessages.update({ threadId: entry.threadId, queuedMessageId: entry.id, expectedUpdatedAt: entry.updatedAt, input });
    }
  }

  // Admission only: enrichment happens after BB has durably queued the message.
  bb.experimental_hooks.on("message.dispatch", async ctx => {
    if (ctx.thread.originPluginId === bb.pluginId || ctx.originPluginId === bb.pluginId) return { action: "proceed" };
    const tokens = [...new Set(ctx.input.blocks.flatMap(b => b.type === "text"
      ? [...b.text.matchAll(/\[bb-moa-draft:([0-9a-f-]{36})\]/g)].map(m => m[1]) : []))];
    if (tokens.length > 1) return { action: "reject", message: "Choose one MoA pair for this draft." };
    if (tokens.length) {
      const selection = store.get<DraftSelection>(`draft:${tokens[0]}`);
      if (!selection || selection.projectId !== ctx.project.id || (selection.threadId && selection.threadId !== ctx.thread.id)) {
        return { action: "reject", message: "This MoA selection belongs to another chat or project. Choose the pair again." };
      }
      if (!localConfig(ctx.thread.id)) {
        if (!ctx.host) return { action: "reject", message: "Choose an existing machine before enabling MoA for the first message." };
        selection.threadId = ctx.thread.id;
        store.put(`draft:${tokens[0]}`, ctx.thread.id, "draft", selection);
        store.put(`config:${ctx.thread.id}`, ctx.thread.id, "config", { config: selection.config, revision: 1 });
        store.put(`bootstrap:${ctx.thread.id}`, ctx.thread.id, "bootstrap", { hostId: ctx.host.id, main: mainAt(ctx) });
        changed(ctx.thread.id);
      }
    }
    const cfg = configured(ctx.thread.id);
    if (!cfg?.config.enabled) {
      if (cleanInput(ctx.input.blocks).length !== ctx.input.blocks.length && ctx.queuedMessage) {
        return { action: "wait", reason: "MoA: restoring normal mode" };
      }
      return { action: "proceed" };
    }
    const main = mainAt(ctx);
    // A provider retry can carry the already enriched input without a queue row.
    const matching = store.list<Run>(ctx.thread.id, "run").find(r =>
      (r.status === "ready" || r.status === "dispatched") && r.revision === cfg.revision
      && r.fingerprint === fingerprint(ctx.input.blocks, main, cfg.revision)
      && r.advice && ctx.input.blocks.some(b => b.type === "text" && b.visibility === "agent-only"
        && b.text === (runReference(r) as { text: string }).text));
    if (matching) return { action: "proceed" };
    const run = ctx.queuedMessage ? runFor(ctx.queuedMessage.id) : null;
    if (run?.status === "failed" && current(run, ctx.queuedMessage!, main)) {
      return { action: "wait", reason: `MoA: ${run.error ?? "consultation failed"}` };
    }
    return { action: "wait", reason: "MoA: consulting both participants" };
  });

  async function requestAdvice(run: Run, member: Member, signal: AbortSignal) {
    if (member.status === "ready") return;
    member.advisor = { ...member.advisor, agentId: null };
    let workerId: string | null = null;
    let baseline = 0;
    let stage = "Preparing consultation";
    const saveMember = () => {
      const saved = store.get<Run>(`run:${run.id}`);
      if (saved && ["bypassed", "dispatched", "cancelled"].includes(saved.status)) { run.status = saved.status; run.finishedAt = saved.finishedAt; }
      saveRun(run);
    };
    try {
      member.startedAt = Date.now(); member.finishedAt = null; member.status = "running"; member.error = null; saveMember();
      const cfg = configured(run.threadId)!;
      const { thread, environment, bootstrap, spawnEnvironment } = await routing(run.threadId);
      if (bootstrap) {
        stage = "Checking advisor model";
        const catalog = await bb.sdk.providers.models({ hostId: environment.hostId, providerId: member.advisor.providerId });
        if (!catalog.models.some(m => m.model === member.advisor.model)) throw new Error("Advisor model is not available on the selected machine.");
      }
      const sessionKey = `session:${run.threadId}:${hash({ slot: member.advisor, participant: member.key, environment: environment.id, promptVersion: 1 })}`;
      let session = store.get<Session>(sessionKey);
      const previousKeys = [
        `session:${run.threadId}:${hash({ slot: member.advisor, environment: environment.id, promptVersion: 1 })}`,
        ...(!bootstrap ? [
          `session:${run.threadId}:${hash({ slot: member.advisor, participant: member.key, environment: `bootstrap:${environment.hostId}`, promptVersion: 1 })}`,
          `session:${run.threadId}:${hash({ slot: member.advisor, environment: `bootstrap:${environment.hostId}`, promptVersion: 1 })}`,
        ] : []),
      ];
      for (const key of previousKeys) {
        if (session) break;
        session = store.get<Session>(key);
        if (session) { store.put(sessionKey, thread.id, "session", session); store.delete(key); }
      }
      if (session) {
        const worker = await bb.sdk.threads.get({ threadId: session.workerId }).catch(() => null);
        if (!worker || worker.deletedAt || worker.archivedAt) session = null;
      }
      stage = "Reading conversation history";
      const timeline = await bb.sdk.threads.timeline({ threadId: run.threadId, segmentLimit: "50" });
      const rows = timeline.rows.filter(row => row.kind === "conversation" && row.sourceSeqEnd > (session?.cursor ?? 0));
      const history = boundedContext(rows.map(row => row.kind === "conversation" ? `${row.role}: ${row.text}` : "").join("\n\n"));
      const prompt = `${ADVISOR_PROMPT}\n\nCanonical conversation updates (may be a bounded recent window):\n${history || "No new completed messages."}\n\nCurrent user request:\n${boundedContext(textOf(run.input), 30000)}`;
      if (signal.aborted || shutdown.signal.aborted) return;
      member.status = "running"; saveMember();
      stage = "Starting advisor session";
      if (session) {
        workerId = session.workerId;
        baseline = (await bb.sdk.threads.timeline({ threadId: workerId, segmentLimit: "5" })).maxSeq;
        member.workerId = workerId; saveMember();
        member.advisorInput = prompt; saveMember();
        await bb.sdk.threads.send({ threadId: workerId, mode: "auto", input: [{ type: "text", text: prompt, mentions: [] }],
          model: member.advisor.model, reasoningLevel: member.advisor.reasoningLevel, serviceTier: member.advisor.serviceTier, permissionMode: "accept-edits" });
      } else {
        if (signal.aborted || shutdown.signal.aborted) return;
        member.advisorInput = prompt; saveMember();
        const worker = await bb.sdk.threads.spawn({
          projectId: thread.projectId, environment: spawnEnvironment,
          providerId: member.advisor.providerId, model: member.advisor.model, reasoningLevel: member.advisor.reasoningLevel, serviceTier: member.advisor.serviceTier,
          permissionMode: "accept-edits", visibility: "hidden", title: `MoA advisor · ${member.advisor.model}`,
          // No parentThreadId: BB auto-notifies parents on child completion, which would
          // deliver an unsolicited second message. The relationship is plugin-owned.
          pluginMetadata: { parentThreadId: thread.id, role: "advisor", participant: member.key },
          prompt: prompt,
        });
        workerId = worker.id; member.workerId = workerId; saveMember();
        session = { workerId, cursor: 0, environmentId: environment.id };
        store.put(sessionKey, thread.id, "session", session);
      }
      const started = Date.now();
      let nextObservation = 0;
      stage = "Waiting for advisor";
      while (!signal.aborted && !shutdown.signal.aborted) {
        const worker = await bb.sdk.threads.get({ threadId: workerId });
        if (worker.archivedAt || worker.deletedAt) throw new Error("Advisor cancelled");
        const overdue = Date.now() - started > (configured(run.threadId)?.config.timeoutSeconds ?? cfg.config.timeoutSeconds) * 1000;
        if (Date.now() >= nextObservation) {
          // Native events expose progress without reading documents or inferring
          // inactivity from missing text. Silent reasoning may still be active.
          const recent = await bb.sdk.threads.events.list({ threadId: workerId, order: "desc", limit: "1" }).catch(() => []);
          if (signal.aborted || shutdown.signal.aborted) return;
          member.progress = { state: worker.runtime?.displayStatus ?? worker.status, observedAt: Date.now(),
            lastEventAt: recent[0]?.createdAt ?? member.progress?.lastEventAt ?? null,
            lastEventType: recent[0]?.type ?? member.progress?.lastEventType ?? null, overdue };
          run.progress = { ...member.progress, state: `${run.members?.filter(m => m.status === "ready").length ?? 0}/2 ready`,
            overdue: run.members?.some(m => m.progress?.overdue) ?? false };
          saveMember(); nextObservation = Date.now() + 3000;
        }
        if (worker.status === "idle" && !worker.queuedMessageCount && !worker.activeBackgroundAgentCount) {
          const completed = await bb.sdk.threads.timeline({ threadId: workerId, segmentLimit: "5" });
          if (completed.rows.some(row => row.kind === "conversation" && row.role === "assistant" && row.sourceSeqEnd > baseline)) break;
          if (overdue) throw new Error("Advisor stopped without a final answer");
        }
        if (worker.status === "error") throw new Error("Advisor provider unavailable");
        // The threshold is informational for active/starting/pending work. BB
        // owns provider liveness; only explicit cancellation or failure stops it.
        await delay(500, signal);
      }
      if (signal.aborted || shutdown.signal.aborted) return;
      const output = (await abortable(bb.sdk.threads.output({ threadId: workerId, signal }), signal))?.output?.trim();
      if (signal.aborted || shutdown.signal.aborted) return;
      if (!output) throw new Error("Empty advisor response");
      member.advice = output.slice(0, 32000); member.status = "ready"; member.finishedAt = Date.now();
      store.put(sessionKey, thread.id, "session", { ...session, cursor: timeline.maxSeq });
      saveMember();
    } catch (error) {
      if (!signal.aborted && !shutdown.signal.aborted) {
        member.status = "failed"; member.error = `${stage}: ${safeError(error)}`; member.finishedAt = Date.now(); saveMember();
        bb.log.warn(`Consultation ${run.id}, participant ${member.key} failed (${member.advisor.providerId}).`);
      }
    } finally {
      if (workerId) await bb.sdk.threads.stop({ threadId: workerId }).catch(() => {});
      if (signal.aborted && !shutdown.signal.aborted && member.status !== "ready") {
        member.status = "cancelled"; member.finishedAt = Date.now(); saveMember();
      }
    }
  }

  async function consultMember(run: Run, member: Member, signal: AbortSignal) {
    if (member.status === "ready") return;
    const control = { abort: new AbortController(), replace: false };
    const key = `${run.id}:${member.key}`;
    memberControls.set(key, control);
    try {
      if (member.status !== "failed") await requestAdvice(run, member, AbortSignal.any([signal, control.abort.signal]));
      if (signal.aborted || shutdown.signal.aborted) return;
      const config = configured(run.threadId)!.config;
      if (!member.primaryAdvisor && config.reserve && (control.replace || (member.status === "failed" && config.failurePolicy === "reserve"))) {
        const { key: _, primaryAdvisor: __, attempts: ___, advisorInput: ____, ...previous } = member;
        member.attempts = [...(member.attempts ?? []), previous];
        member.primaryAdvisor = member.advisor;
        member.advisor = config.reserve;
        member.workerId = null; member.status = "waiting"; member.error = null; member.advice = null; member.progress = undefined; member.advisorInput = undefined;
        saveRun(run);
        await requestAdvice(run, member, signal);
      }
    } finally { memberControls.delete(key); }
  }

  async function consult(run: Run, signal: AbortSignal) {
    try {
      run.status = "running"; saveRun(run);
      // Every participant gets the same canonical updates independently. Neither
      // sees its peer's fresh proposal. BB owns provider capacity and queuing.
      await Promise.all(run.members!.map(member => consultMember(run, member, signal)));
      if (signal.aborted || shutdown.signal.aborted) return;
      const failed = run.members!.filter(member => member.status !== "ready");
      const available = run.members!.filter(member => member.status === "ready" && member.advice);
      const allowPartial = configured(run.threadId)?.config.failurePolicy === "available" && available.length > 0;
      if (failed.length && !allowPartial) {
        run.status = "failed"; run.error = failed.map(m => `${m.key.toUpperCase()} (${m.advisor.model}): ${m.error ?? "No final answer"}`).join("\n");
        run.finishedAt = Date.now(); saveRun(run); await recheck(); return;
      }
      const entry = (await queue(run.threadId)).find(q => q.id === run.queueId);
      const main = entry ? { ...run.aggregator, model: entry.model } : run.aggregator;
      if (!entry || !current(run, entry, main)) {
        run.status = "cancelled"; run.finishedAt = Date.now(); saveRun(run); return;
      }
      run.partial = failed.length > 0;
      run.advice = available.map(m => `## ${m.key.toUpperCase()} · ${m.advisor.model}\n\n${m.advice}`).join("\n\n---\n\n");
      const reference = runReference(run);
      if (reference.type === "text") run.referenceText = reference.text;
      run.status = "ready"; run.finishedAt = Date.now(); saveRun(run);
      await bb.sdk.threads.queuedMessages.update({ threadId: run.threadId, queuedMessageId: entry.id,
        expectedUpdatedAt: entry.updatedAt, input: [...cleanInput(entry.content), runReference(run)] });
      await recheck();
    } catch (error) {
      if (!signal.aborted && !shutdown.signal.aborted) {
        run.status = "failed"; run.error = safeError(error); run.finishedAt = Date.now(); saveRun(run); await recheck().catch(() => {});
      }
    } finally {
      if (signal.aborted && !shutdown.signal.aborted) {
        const saved = store.get<Run>(`run:${run.id}`);
        if (saved?.status !== "bypassed" && saved?.status !== "dispatched") {
          run.status = "cancelled"; run.finishedAt = Date.now(); saveRun(run);
        }
      }
    }
  }

  async function scan() {
    const entries = await bb.sdk.threads.queue.list({ waitHolder: `plugin:${bb.pluginId}` });
    const visited = new Set<string>();
    for (const entry of entries) {
      if (shutdown.signal.aborted) return;
      const cfg = configured(entry.threadId);
      if (!cfg?.config.enabled) { await strip(entry); await recheck(); continue; }
      if (visited.has(entry.threadId)) continue;
      visited.add(entry.threadId);
      if (active.has(entry.threadId) || active.size >= 2) continue;
      const parent = await bb.sdk.threads.get({ threadId: entry.threadId });
      if (parent.archivedAt || parent.deletedAt) continue;
      const main: Slot = { providerId: parent.providerId, model: entry.model, reasoningLevel: entry.reasoningLevel, agentId: null };
      const fp = fingerprint(entry.content, main, cfg.revision);
      let run = runFor(entry.id);
      if (run && run.fingerprint === fp && run.revision === cfg.revision) {
        if (run.status === "failed") {
          const canRecover = run.members && (cfg.config.failurePolicy === "available" && run.members.some(m => m.status === "ready")
            || cfg.config.failurePolicy === "reserve" && cfg.config.reserve && run.members.some(m => m.status === "failed" && !m.primaryAdvisor));
          if (!canRecover) continue;
          run.status = "waiting";
        }
        if (run.status === "ready" && run.advice) {
          // Recover a crash between saving advice and enriching the queue row.
          await bb.sdk.threads.queuedMessages.update({ threadId: entry.threadId, queuedMessageId: entry.id,
            expectedUpdatedAt: entry.updatedAt, input: [...cleanInput(entry.content), runReference(run)] });
          await recheck(); continue;
        }
        if (run.status === "running") {
          // A previous process may have submitted a billable request. Do not replay it.
          for (const workerId of run.members?.map(m => m.workerId).filter((id): id is string => !!id) ?? (run.workerId ? [run.workerId] : [])) await bb.sdk.threads.stop({ threadId: workerId }).catch(() => {});
          for (const member of run.members ?? []) if (member.status !== "ready") { member.status = "failed"; member.error = "Interrupted by reload"; }
          run.status = "failed"; run.error = "Consultation interrupted by a reload. Retry to continue."; saveRun(run); continue;
        }
      }
      if (run && run.fingerprint !== fp) { run.status = "cancelled"; run.finishedAt = Date.now(); saveRun(run); }
      if (!(run?.members && run.status === "waiting" && run.fingerprint === fp && run.revision === cfg.revision)) {
        run = { id: randomUUID(), queueId: entry.id, threadId: entry.threadId, workerId: null,
          input: cleanInput(entry.content), fingerprint: fp, revision: cfg.revision, status: "waiting",
          advisor: cfg.config.a, aggregator: main, startedAt: Date.now(), finishedAt: null, error: null, advice: null,
          members: (["a", "b"] as const).map(key => ({ key, advisor: cfg.config[key], workerId: null, status: "waiting",
            startedAt: null, finishedAt: null, error: null, advice: null })) };
      }
      saveRun(run); store.put(`queue:${entry.id}`, entry.threadId, "queue", { id: run.id });
      const abort = new AbortController();
      const promise = consult(run, abort.signal).finally(() => active.delete(entry.threadId));
      active.set(entry.threadId, { abort, promise });
    }
  }

  function validateConfig(config: ReturnType<typeof configSchema.parse>) {
    advisorFor(config, config.a);
    if (config.failurePolicy === "reserve" && !config.reserve) throw new Error("Choose a reserve model first.");
    if (config.reserve && [config.a, config.b].some(slot => sameModel(slot, config.reserve!))) throw new Error("The reserve model must differ from A and B.");
  }
  async function saveConfig(threadId: string, value: unknown, updatePair = true) {
    const config = configSchema.parse(value); validateConfig(config);
    await bb.sdk.threads.get({ threadId });
    if (config.enabled) {
      const { environment, bootstrap } = await routing(threadId);
      for (const slot of [config.a, config.b, ...(config.reserve ? [config.reserve] : [])]) {
        const catalog = await bb.sdk.providers.models({ ...(bootstrap ? { hostId: environment.hostId } : { environmentId: environment.id }), providerId: slot.providerId });
        const model = catalog.models.find(m => m.model === slot.model);
        if (!model) throw new Error(`Model is not available: ${slot.model}`);
        if (model.supportedReasoningEfforts.length && !model.supportedReasoningEfforts.some(e => e.reasoningEffort === slot.reasoningLevel)) {
          throw new Error(`Reasoning level is not available for ${slot.model}. Choose it in the model picker.`);
        }
      }
    }
    const old = localConfig(threadId);
    const modeChanged = !old || old.config.enabled !== config.enabled;
    if (modeChanged) active.get(threadId)?.abort.abort();
    store.put(`config:${threadId}`, threadId, "config", { config, revision: (old?.revision ?? 0) + (modeChanged ? 1 : 0) });
    if (updatePair) await saveShared(config);
    if (modeChanged) for (const entry of await queue(threadId)) await strip(entry).catch(() => {});
    changed(threadId); await recheck(); return config;
  }
  async function status(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    return { environmentId: thread.environmentId, config: configured(threadId)?.config ?? null, main: await mainSlot(threadId), runs: store.list<Run>(threadId, "run").slice(0, 20).map(run => runSchema.parse(run)) };
  }
  async function retry(threadId: string, runId: string) {
    const run = store.get<Run>(`run:${runId}`);
    if (!run || run.threadId !== threadId || run.status !== "failed") throw new Error("This failed consultation is no longer available.");
    const entry = (await queue(threadId)).find(e => e.id === run.queueId);
    if (!entry) throw new Error("The message is no longer queued.");
    if (run.members && current(run, entry, { ...run.aggregator, model: entry.model })) {
      const next: Run = { ...run, id: randomUUID(), referenceText: undefined, partial: undefined, status: "waiting", error: null, advice: null, progress: undefined, startedAt: Date.now(), finishedAt: null,
        members: run.members.map(member => member.status === "ready" ? { ...member } : { ...member, status: "waiting", error: null, advice: null, progress: undefined, startedAt: null, finishedAt: null }) };
      saveRun(next); store.put(`queue:${entry.id}`, threadId, "queue", { id: next.id });
    } else store.delete(`queue:${entry.id}`);
    changed(threadId); await recheck(); return { ok: true };
  }
  bb.rpc.register(rpcContract, {
    messageIndex: ({ threadId }) => audit.messageIndex(threadId),
    audit: async ({ threadId, runId }) => ({ ...await audit.detail(threadId, runId), canReplace: !!configured(threadId)?.config.reserve }),
    replaceParticipant: ({ threadId, runId, key }) => {
      const run = store.get<Run>(`run:${runId}`);
      const member = run?.members?.find(m => m.key === key);
      const control = memberControls.get(`${runId}:${key}`);
      if (!run || run.threadId !== threadId || !member || member.primaryAdvisor || !control) throw new Error("This participant cannot be replaced now.");
      if (!configured(threadId)?.config.reserve) throw new Error("Choose a reserve model in MoA settings first.");
      control.replace = true; control.abort.abort(); return { ok: true };
    },
    draftDefaults: async ({ projectId }) => {
      const project = await bb.sdk.projects.get({ projectId });
      const defaults = await bb.sdk.projects.defaultExecutionOptions({ projectId });
      const hostId = (project.sources.find(s => s.isDefault) ?? project.sources[0])?.hostId
        ?? (await bb.sdk.system.config()).primaryHostId;
      if (!hostId) throw new Error("Choose a project with an existing machine first.");
      const saved = shared()?.settings ?? store.get<ReturnType<typeof configSchema.parse>>(`template:${projectId}`);
      if (saved) return { hostId, config: { ...saved, enabled: false } };
      const providerId = defaults?.providerId ?? (await bb.sdk.providers.list({ hostId })).find(p => p.available)?.id;
      if (!providerId) throw new Error("No provider is available on this machine.");
      const catalog = await bb.sdk.providers.models({ hostId, providerId });
      const first = catalog.models.find(m => m.model === defaults?.model) ?? catalog.models[0];
      if (!first) throw new Error("Choose a default provider and model for the project first.");
      const second = catalog.models.find(m => m.model !== first.model) ?? first;
      const slot = (m: typeof first): Slot => ({ providerId, model: m.model, reasoningLevel: m.defaultReasoningEffort, agentId: null });
      return { hostId, config: { a: slot(first), b: slot(second), enabled: false, timeoutSeconds: 240 } };
    },
    prepareDraft: async ({ projectId, config }) => {
      await bb.sdk.projects.get({ projectId });
      validateConfig(config);
      await saveShared(config);
      const token = randomUUID();
      store.put(`draft:${token}`, projectId, "draft", { config: { ...config, enabled: true }, projectId, threadId: null });
      return { token };
    },
    readDraft: ({ token }) => {
      const selection = store.get<DraftSelection>(`draft:${token}`);
      if (!selection) throw new Error("Choose the MoA pair again.");
      return { ...selection.config, ...shared()?.settings };
    },
    status: ({ threadId }) => status(threadId),
    save: ({ threadId, config }) => saveConfig(threadId, config),
    toggle: ({ threadId, enabled }) => {
      const cfg = configured(threadId); if (!cfg) throw new Error("Choose your model pair first.");
      return saveConfig(threadId, { ...cfg.config, enabled }, false);
    },
    retry: ({ threadId, runId }) => retry(threadId, runId),
    providers: async ({ threadId }) => {
      const { environment } = await routing(threadId);
      return (await bb.sdk.providers.list({ environmentId: environment.id })).map(p => ({ id: p.id, name: p.displayName, available: p.available }));
    },
    models: async ({ threadId, providerId }) => {
      const { environment } = await routing(threadId);
      const result = await bb.sdk.providers.models({ environmentId: environment.id, providerId });
      return result.models.map(m => ({ model: m.model, name: m.displayName, efforts: m.supportedReasoningEfforts.map(e => e.reasoningEffort) }));
    },

  });
  bb.ui.registerMentionProvider({ id: "draft", label: "MoA", search: () => [], resolve: token => {
    if (!store.get<DraftSelection>(`draft:${token}`)) throw new Error("Choose the MoA pair again.");
    return { context: `[bb-moa-draft:${token}]\nMoA configuration attached to the initial request. The coordinator supplies any advisor reference separately.` };
  } });

  bb.cli.register({ name: "moa", summary: "Configure per-chat Mixture of Agents and inspect consultations",
    commands: [
      { name: "status", summary: "Inspect one chat", usage: "bb moa status THREAD_ID" },
      { name: "configure", summary: "Save a model pair", usage: "bb moa configure THREAD_ID CONFIG_JSON" },
      { name: "on", summary: "Enable MoA", usage: "bb moa on THREAD_ID" },
      { name: "off", summary: "Disable MoA", usage: "bb moa off THREAD_ID" },
      { name: "retry", summary: "Retry a failed consultation", usage: "bb moa retry THREAD_ID RUN_ID" },
    ],
    async run(argv) {
      try {
        const [command, threadId, value] = argv.filter(a => a !== "--json");
        if (!threadId) return { exitCode: 1, stderr: "Usage: bb moa status|on|off|configure|retry THREAD_ID [CONFIG_JSON|RUN_ID]" };
        let result: unknown;
        if (command === "status") {
          const state = await status(threadId);
          result = { ...state, runs: state.runs.map(run => ({ ...run, advice: run.advice?.slice(0, 1200) ?? null })) };
        }
        else if (command === "configure" && value) result = await saveConfig(threadId, JSON.parse(value));
        else if (command === "on" || command === "off") {
          const cfg = configured(threadId); if (!cfg) throw new Error("Choose a model pair first.");
          result = await saveConfig(threadId, { ...cfg.config, enabled: command === "on" }, false);
        } else if (command === "retry" && value) result = await retry(threadId, value);
        else throw new Error("Unknown command.");
        return { exitCode: 0, stdout: JSON.stringify(result) };
      } catch (error) { return { exitCode: 1, stderr: error instanceof Error ? error.message : "Invalid request" }; }
    },
  });
  bb.agents.configure(ctx => ctx.origin.pluginId === bb.pluginId ? { tools: [], skills: [], instructions: ADVISOR_PROMPT } : { tools: [], skills: [] });
  bb.events.on("message.cancelled", ({ entry }) => {
    const run = runFor(entry.id); if (!run) return;
    active.get(entry.threadId)?.abort.abort(); run.status = "cancelled"; run.finishedAt = Date.now(); saveRun(run);
  });
  bb.events.on("message.dispatched", ({ entry }) => {
    const run = runFor(entry.id); if (!run) return;
    const enriched = entry.content.some(b => b.type === "text" && b.visibility === "agent-only" && b.text.startsWith(`[bb-moa-reference:${run.id}]`));
    run.status = enriched && run.advice ? "dispatched" : "bypassed";
    run.finishedAt = Date.now(); saveRun(run);
    if (!enriched) active.get(entry.threadId)?.abort.abort();
  });
  for (const event of ["thread.archived", "thread.deleted"] as const) bb.events.on(event, async ({ thread }) => {
    active.get(thread.id)?.abort.abort();
    for (const session of store.list<Session>(thread.id, "session")) {
      await bb.sdk.threads.archive({ threadId: session.workerId }).catch(() => {});
      await bb.sdk.threads.stop({ threadId: session.workerId }).catch(() => {});
    }
  });
  bb.background.service("consultations", { async start(signal) {
    while (!signal.aborted && !shutdown.signal.aborted) {
      try { await scan(); } catch { if (!signal.aborted) bb.log.warn("Could not scan MoA queue; will retry."); }
      await delay(1000, signal);
    }
  } });
  bb.onDispose(async () => {
    shutdown.abort(); for (const job of active.values()) job.abort.abort();
    await Promise.allSettled([...active.values()].map(j => j.promise));
  });
}
