import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeMessageDispatchHookContext, makeQueueEntry, makeThreadResponse,
  experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { type Config, type RunView } from "../contract";
import type { Input } from "../core";
const a = { providerId: "codex", model: "a", reasoningLevel: "medium" as const, agentId: null };
const b = { ...a, model: "b" };
const config: Config = { a, b, enabled: true, timeoutSeconds: 30 };
const text = (value: string): Input[number] => ({ type: "text", text: value, mentions: [] });
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); vi.restoreAllMocks(); });
async function eventually(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 4000;
  while (!(await check())) { if (Date.now() > deadline) throw new Error("Condition not reached"); await new Promise(r => setTimeout(r, 15)); }
}
async function setup(configure = true) {
  const { bb, harness } = createFakePluginHost({ pluginId: "moa" });
  const parent = makeThreadResponse({ id: "parent", projectId: "project", environmentId: "env", providerId: "codex", status: "idle" });
  const worker = makeThreadResponse({ id: "worker", projectId: "project", environmentId: "env", providerId: "codex", originPluginId: "moa", status: "idle" });
  let entries = [makeQueueEntry({ id: "q1", threadId: "parent", content: [text("Question one")], model: "a", reasoningLevel: "medium",
    waitingOn: { kind: "plugin", pluginId: "moa", reason: "consulting" } })];
  let workerSeq = 1;
  let parentSeq = 10;
  let output: () => Promise<{ output: string }> = async () => ({ output: "Use the available evidence; verify the uncertain claim." });
  const stub = harness.inspection.sdk.stub;
  stub("projects.get", async () => ({ id: "project", kind: "standard", sources: [{ hostId: "host", path: "/workspace", isDefault: true }] }));
  stub("threads.get", async ({ threadId }: { threadId: string }) => threadId === "parent" ? parent : worker);
  stub("environments.get", async () => ({ id: "env", hostId: "host", projectId: "project", path: "/workspace" }));
  stub("threads.defaultExecutionOptions", async () => ({ providerId: "codex", model: "a", reasoningLevel: "medium" }));
  stub("threads.queuedMessages.list", async () => entries);
  stub("threads.queue.list", async () => entries);
  stub("threads.queuedMessages.update", async (args: { queuedMessageId: string; expectedUpdatedAt: number; input: Input }) => {
    const entry = entries.find(q => q.id === args.queuedMessageId);
    if (!entry || args.expectedUpdatedAt !== entry.updatedAt) throw new Error("CAS conflict");
    entry.content = args.input; entry.updatedAt++; return entry;
  });
  stub("threads.timeline", async ({ threadId }: { threadId: string }) => ({
    maxSeq: threadId === "parent" ? parentSeq : workerSeq,
    rows: [{ kind: "conversation", role: "assistant", text: threadId === "parent" ? "The accepted decision was BLUE." : "Advisor result", sourceSeqEnd: threadId === "parent" ? parentSeq : workerSeq }],
  }));
  stub("threads.spawn", async () => { workerSeq++; return worker; });
  stub("threads.send", async () => { workerSeq++; return {}; });
  stub("threads.output", async () => output());
  stub("threads.events.list", async () => []);
  stub("threads.stop", async () => ({ ok: true }));
  stub("threads.archive", async () => ({}));
  stub("providers.models", async () => ({ models: [a, b].map(s => ({ model: s.model, supportedReasoningEfforts: [{ reasoningEffort: "medium" }] })) }));
  plugin(bb);
  disposers.push(() => harness.lifecycle.dispose());
  if (configure) await harness.behavior.callRpc("save", { threadId: "parent", config });
  const hook = () => harness.inspection.registrations.hooks["message.dispatch"]!;
  const context = (input = entries[0]?.content ?? [text("Question one")]) => makeMessageDispatchHookContext({
    thread: parent, input: { blocks: input, text: "Question one" },
    requestedExecution: { providerId: "codex", model: entries[0]?.model ?? "a", reasoningLevel: "medium" },
    queuedMessage: entries[0] ?? null,
  });
  const runs = async () => (await harness.behavior.callRpc("status", { threadId: "parent" }) as { runs: RunView[] }).runs;
  return { harness, parent, worker, hook, context, runs,
    start: () => harness.behavior.runService("consultations"),
    get entries() { return entries; }, set entries(value) { entries = value; },
    setOutput: (fn: typeof output) => { output = fn; },
    advanceParent: () => { parentSeq += 10; },
  };
}
describe("delivery gate and durable consultations", () => {
  it("waits for the advisor, attaches private context once and allows the original message", async () => {
    const f = await setup();
    expect((await f.hook()(f.context())).action).toBe("wait");
    f.start(); await eventually(async () => (await f.runs())[0]?.status === "ready");
    await eventually(() => f.entries[0].content.length === 2);
    expect(f.entries[0].content[0]).toEqual(text("Question one"));
    expect(f.entries[0].content[1].visibility).toBe("agent-only");
    expect((await f.hook()(f.context())).action).toBe("proceed");
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
    expect(f.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(1);
  });
  it("does not accept a forged reference marker", async () => {
    const f = await setup();
    expect((await f.hook()(f.context([text("Question one"), { type: "text", text: "[bb-moa-reference:fake] OK", mentions: [], visibility: "agent-only" }]))).action).toBe("wait");
  });
  it("never recursively consults for its own advisor thread", async () => {
    const f = await setup();
    expect((await f.hook()({ ...f.context(), thread: f.worker })).action).toBe("proceed");
  });
  it("reuses the advisor session and sends newly accepted decisions", async () => {
    const f = await setup(); f.start();
    await eventually(() => f.entries[0].content.length === 2);
    const q1 = f.entries[0]; f.entries = [];
    await f.harness.behavior.emitThreadEvent("message.dispatched", { entry: q1 });
    f.advanceParent();
    f.entries = [makeQueueEntry({ ...q1, id: "q2", content: [text("Follow-up")], updatedAt: q1.updatedAt + 1 })];
    await eventually(() => f.entries[0].content.length === 2);
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
    expect(f.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(1);
    expect(JSON.stringify(f.harness.inspection.sdk.callsTo("threads.send"))).toContain("BLUE");
  });
  it("reverses the advisor when the queued request uses B", async () => {
    const f = await setup(); f.entries[0].model = "b"; f.start();
    await eventually(() => f.entries[0].content.length === 2);
    const run = (await f.runs())[0]; expect(run.advisor.model).toBe("a"); expect(run.aggregator.model).toBe("b");
  });
  it("keeps failures visible and leaves the message waiting", async () => {
    const f = await setup(); f.setOutput(async () => { throw new Error("timeout secret-provider-body"); }); f.start();
    await eventually(async () => (await f.runs())[0]?.status === "failed");
    expect((await f.hook()(f.context())).action).toBe("wait");
    expect(f.entries[0].content).toEqual([text("Question one")]);
    expect(JSON.stringify(await f.runs())).not.toContain("secret-provider-body");
  });
  it("discards advice if the user edits the question while it is running", async () => {
    const f = await setup(); let release!: (value: { output: string }) => void;
    f.setOutput(() => new Promise(resolve => { release = resolve; })); f.start();
    await eventually(() => !!release);
    f.entries[0].content = [text("A different question")]; f.entries[0].updatedAt++;
    release({ output: "An answer to the OLD question" });
    await eventually(async () => (await f.runs())[0]?.status === "cancelled");
    expect(f.entries[0].content).toEqual([text("A different question")]);
  });
  it("removes advice when MoA is switched off and permits normal delivery", async () => {
    const f = await setup(); f.start(); await eventually(() => f.entries[0].content.length === 2);
    await f.harness.behavior.callRpc("toggle", { threadId: "parent", enabled: false });
    expect(f.entries[0].content).toEqual([text("Question one")]);
    expect((await f.hook()(f.context())).action).toBe("proceed");
  });
  it("records an explicit BB send-now override as bypassed", async () => {
    const f = await setup(); let release!: (value: { output: string }) => void;
    f.setOutput(() => new Promise(resolve => { release = resolve; })); f.start(); await eventually(() => !!release);
    const entry = f.entries[0]; f.entries = [];
    await f.harness.behavior.emitThreadEvent("message.dispatched", { entry });
    release({ output: "Late answer" });
    await eventually(() => f.harness.inspection.sdk.callsTo("threads.stop").length === 1);
    expect((await f.runs())[0].status).toBe("bypassed");
  });
  it("retains configuration and a completed consultation across reload", async () => {
    const f = await setup(); f.start(); await eventually(() => f.entries[0].content.length === 2);
    const next = await f.harness.lifecycle.reload(plugin);
    disposers.push(() => next.harness.lifecycle.dispose());
    next.harness.inspection.sdk.stub("threads.get", async () => f.parent);
    next.harness.inspection.sdk.stub("threads.defaultExecutionOptions", async () => ({ providerId: "codex", model: "a", reasoningLevel: "medium" }));
    const state = await next.harness.behavior.callRpc("status", { threadId: "parent" }) as { config: Config; runs: RunView[] };
    expect(state.config).toEqual(config); expect(state.runs[0].status).toBe("ready");
    expect((await next.harness.inspection.registrations.hooks["message.dispatch"]!(f.context())).action).toBe("proceed");
    expect(next.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });
  it("keeps an old failure in history after a successful retry", async () => {
    const f = await setup(); f.setOutput(async () => { throw new Error("timeout"); }); f.start();
    await eventually(async () => (await f.runs())[0]?.status === "failed");
    const failed = (await f.runs())[0]; f.setOutput(async () => ({ output: "Recovered advice" }));
    await f.harness.behavior.callRpc("retry", { threadId: "parent", runId: failed.id });
    await eventually(() => f.entries[0].content.length === 2);
    expect((await f.runs()).map(r => r.status)).toEqual(["ready", "failed"]);
  });
  it("does not let a later question overtake a failed question in the same chat", async () => {
    const f = await setup(); f.setOutput(async () => { throw new Error("timeout"); }); f.start();
    await eventually(async () => (await f.runs())[0]?.status === "failed");
    f.entries.push(makeQueueEntry({ ...f.entries[0], id: "q2", content: [text("Question two")] }));
    await new Promise(r => setTimeout(r, 1100));
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
    expect(await f.runs()).toHaveLength(1);
  });
  it("binds a draft before the first message and retains its advisor after provisioning", async () => {
    const f = await setup(false);
    f.parent.environmentId = null; f.parent.status = "pending";
    const { token } = await f.harness.behavior.callRpc("prepareDraft", { projectId: "project", config }) as { token: string };
    f.entries[0].content.push(text(`[bb-moa-draft:${token}]`));
    const base = f.context();
    const ctx = { ...base, project: { ...base.project, id: "project" }, host: { ...base.host!, id: "host" }, environment: null };
    expect((await f.hook()(ctx)).action).toBe("wait");
    f.start(); await eventually(() => f.entries[0].content.length === 3);
    const spawn = f.harness.inspection.sdk.callsTo("threads.spawn")[0];
    expect(JSON.stringify(spawn)).toContain('"type":"unmanaged"');
    expect(JSON.stringify(spawn)).toContain('"path":"/workspace"');
    expect((await f.hook()({ ...ctx, input: { ...ctx.input, blocks: f.entries[0].content } })).action).toBe("proceed");
    const first = f.entries[0]; f.entries = [];
    await f.harness.behavior.emitThreadEvent("message.dispatched", { entry: first });
    f.parent.environmentId = "env"; f.parent.status = "idle"; f.advanceParent();
    f.entries = [makeQueueEntry({ ...first, id: "q2", content: [text("Follow-up")], updatedAt: first.updatedAt + 1 })];
    await eventually(() => f.entries[0].content.length === 2);
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
    expect(f.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(1);
  });
  it("loads a model pair for a new chat without a project source", async () => {
    const f = await setup(false);
    f.harness.inspection.sdk.stub("projects.get", async () => ({ id: "project", sources: [] }));
    f.harness.inspection.sdk.stub("projects.defaultExecutionOptions", async () => null);
    f.harness.inspection.sdk.stub("system.config", async () => ({ primaryHostId: "host" }));
    f.harness.inspection.sdk.stub("providers.list", async () => [{ id: "codex", available: true }]);
    const result = await f.harness.behavior.callRpc("draftDefaults", { projectId: "project" }) as { hostId: string; config: Config };
    expect(result.hostId).toBe("host"); expect(result.config.enabled).toBe(false);
    expect(result.config.a.model).toBe("a"); expect(result.config.b.model).toBe("b");
  });
  it("does not enable a new chat without its draft token", async () => {
    const f = await setup(false); f.parent.environmentId = null;
    await f.harness.behavior.callRpc("prepareDraft", { projectId: "project", config });
    expect((await f.hook()(f.context())).action).toBe("proceed");
  });
  it("rejects a draft selection sent to another project", async () => {
    const f = await setup(false);
    const { token } = await f.harness.behavior.callRpc("prepareDraft", { projectId: "project", config }) as { token: string };
    const ctx = f.context([text(`[bb-moa-draft:${token}]`)]);
    expect((await f.hook()({ ...ctx, project: { ...ctx.project, id: "another" } })).action).toBe("reject");
  });
  it("does not re-enable MoA when the first message is retried after switching off", async () => {
    const f = await setup(false);
    const { token } = await f.harness.behavior.callRpc("prepareDraft", { projectId: "project", config }) as { token: string };
    const base = f.context([text(`[bb-moa-draft:${token}]`)]);
    const ctx = { ...base, project: { ...base.project, id: "project" }, host: { ...base.host!, id: "host" } };
    expect((await f.hook()(ctx)).action).toBe("wait");
    await f.harness.behavior.callRpc("toggle", { threadId: "parent", enabled: false });
    expect((await f.hook()(ctx)).action).toBe("proceed");
  });
  it("can turn MoA off even if the first-message workspace is unavailable", async () => {
    const f = await setup(false); f.parent.environmentId = null;
    const { token } = await f.harness.behavior.callRpc("prepareDraft", { projectId: "project", config }) as { token: string };
    const base = f.context([text(`[bb-moa-draft:${token}]`)]);
    const ctx = { ...base, project: { ...base.project, id: "project" }, host: { ...base.host!, id: "host" } };
    expect((await f.hook()(ctx)).action).toBe("wait");
    f.harness.inspection.sdk.stub("projects.get", async () => ({ id: "project", kind: "standard", sources: [] }));
    await f.harness.behavior.callRpc("toggle", { threadId: "parent", enabled: false });
    expect((await f.hook()(ctx)).action).toBe("proceed");
  });
  it("shares models, profiles and timeout across existing chats and project drafts, keeping toggles local", async () => {
    const f = await setup();
    f.entries = [];
    f.harness.inspection.sdk.stub("projects.defaultExecutionOptions", async () => null);
    const other = await f.harness.behavior.callRpc("status", { threadId: "other" }) as { config: Config };
    expect(other.config).toEqual({ ...config, enabled: false });
    await f.harness.behavior.callRpc("toggle", { threadId: "other", enabled: true });
    const pair = { ...config, a: { ...b, agentId: "researcher" }, b: a, timeoutSeconds: 300, enabled: false };
    await f.harness.behavior.callRpc("save", { threadId: "other", config: pair });
    expect((await f.harness.behavior.callRpc("status", { threadId: "parent" }) as { config: Config }).config).toEqual({ ...pair, enabled: true });
    expect((await f.harness.behavior.callRpc("draftDefaults", { projectId: "another-project" }) as { config: Config }).config).toEqual(pair);
    await f.harness.behavior.callRpc("toggle", { threadId: "parent", enabled: false });
    expect((await f.harness.behavior.callRpc("status", { threadId: "other" }) as { config: Config }).config).toEqual(pair);
  });
  it("uses the latest shared pair for an older draft and preserves native profile routing on first submission", async () => {
    const f = await setup(false); f.parent.environmentId = null;
    const { token } = await f.harness.behavior.callRpc("prepareDraft", { projectId: "project", config }) as { token: string };
    const updated = { ...config, b: { ...b, agentId: "researcher" } };
    await f.harness.behavior.callRpc("prepareDraft", { projectId: "another-project", config: updated });
    expect(await f.harness.behavior.callRpc("readDraft", { token })).toEqual(updated);
    f.harness.inspection.sdk.stub("plugins.callRpc", async () => ({ token: "11111111-1111-4111-8111-111111111111", label: "researcher" }));
    const base = f.context([text(`[bb-moa-draft:${token}]`)]);
    const ctx = { ...base, project: { ...base.project, id: "project" }, host: { ...base.host!, id: "host" } };
    expect((await f.hook()(ctx)).action).toBe("wait");
    f.start(); await eventually(() => f.entries[0].content.length === 2);
    expect((await f.runs())[0].advisor.agentId).toBe("researcher");
    const calls = JSON.stringify(f.harness.inspection.sdk.callsTo("plugins.callRpc"));
    expect(calls).toContain('"hostId":"host"');
    expect(calls).toContain('"projectId":"project"');
    expect(calls).not.toContain('"environmentId"');
  });
  it("invalidates ready advice in another chat when the shared pair changes", async () => {
    const f = await setup(); f.start();
    await eventually(() => f.entries[0].content.length === 2);
    await f.harness.behavior.callRpc("save", { threadId: "other", config: { ...config, b: { ...b, agentId: "researcher" } } });
    f.harness.inspection.sdk.stub("plugins.callRpc", async () => ({ token: "11111111-1111-4111-8111-111111111111", label: "researcher" }));
    expect(f.entries[0].content).toEqual([text("Question one")]);
    expect((await f.hook()(f.context())).action).toBe("wait");
    await eventually(async () => (await f.runs())[0]?.advisor.agentId === "researcher" && f.entries[0].content.length === 2);
  });
  it("keeps a silent active advisor running beyond 2040 seconds and accepts its eventual answer", async () => {
    const f = await setup(); f.worker.status = "active"; f.worker.runtime.displayStatus = "active";
    let now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now);
    f.start(); await eventually(async () => !!(await f.runs())[0]?.progress);
    now += 2041 * 1000;
    await eventually(async () => !!(await f.runs())[0]?.progress?.overdue);
    expect((await f.runs())[0].status).toBe("running");
    expect(f.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(0);
    f.worker.status = "idle"; f.worker.runtime.displayStatus = "idle";
    await eventually(() => f.entries[0].content.length === 2);
    expect((await f.hook()(f.context())).action).toBe("proceed");
    expect(f.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(1);
  });
  it("lets the user cancel a long pending consultation without delivering late advice", async () => {
    const f = await setup(); f.worker.status = "pending"; f.worker.runtime.displayStatus = "pending";
    let now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now);
    f.start(); await eventually(async () => !!(await f.runs())[0]?.progress);
    now += 3600 * 1000;
    await eventually(async () => !!(await f.runs())[0]?.progress?.overdue);
    expect(f.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(0);
    await f.harness.behavior.callRpc("toggle", { threadId: "parent", enabled: false });
    await eventually(() => f.harness.inspection.sdk.callsTo("threads.stop").length === 1);
    expect((await f.hook()(f.context())).action).toBe("proceed");
    expect(f.entries[0].content).toHaveLength(1);
  });
  it("does not interrupt an active advisor when only its notice threshold is saved", async () => {
    const f = await setup(); f.worker.status = "active"; f.worker.runtime.displayStatus = "active";
    f.start(); await eventually(async () => !!(await f.runs())[0]?.progress);
    const runId = (await f.runs())[0].id;
    await f.harness.behavior.callRpc("save", { threadId: "parent", config: { ...config, timeoutSeconds: 900 } });
    expect(f.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(0);
    f.worker.status = "idle"; f.worker.runtime.displayStatus = "idle";
    await eventually(() => f.entries[0].content.length === 2);
    expect((await f.runs())[0].id).toBe(runId);
    expect((await f.hook()(f.context())).action).toBe("proceed");
  });
  it("uses only public SDK imports", async () => {
    const result = await experimental_scanPublicSdkOnly(process.cwd(), { allow: [
      /^react(?:-dom)?(?:\/.*)?$/, /^@\/components\//, /^@radix-ui\//, /^@hugeicons\//,
      /^@testing-library\//, /^vitest\/config$/,
      /^(?:clsx|tailwind-merge|class-variance-authority)$/,
    ] });
    expect(result.violations).toEqual([]); expect(result.privateDependencies).toEqual([]);
  });
});
