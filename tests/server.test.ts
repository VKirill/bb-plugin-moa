import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeMessageDispatchHookContext, makeQueueEntry, makeThreadResponse,
  experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { type Config, type RunView } from "../contract";
import type { Input } from "../core";
const a = { providerId: "codex", model: "a", reasoningLevel: "medium" as const, agentId: null };
const b = { ...a, model: "b" };
const reserve = { ...a, model: "reserve" };
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
  let pendingOutput: Promise<{ output: string }> | null = null;
  let output: () => Promise<{ output: string }> = async () => ({ output: "Use the available evidence; verify the uncertain claim." });
  const stub = harness.inspection.sdk.stub;
  stub("projects.get", async () => ({ id: "project", kind: "standard", sources: [{ hostId: "host", path: "/workspace", isDefault: true }] }));
  stub("threads.get", async ({ threadId }: { threadId: string }) => threadId === "parent" ? parent : { ...worker, id: threadId });
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
  stub("threads.spawn", async ({ model }: { model: string }) => { workerSeq++; return { ...worker, id: `worker-${model}` }; });
  stub("threads.send", async () => { workerSeq++; return {}; });
  stub("threads.output", async () => pendingOutput ??= output());
  stub("threads.events.list", async () => []);
  stub("threads.stop", async () => ({ ok: true }));
  stub("threads.archive", async () => ({}));
  stub("providers.models", async () => ({ models: [a, b, reserve].map(s => ({ model: s.model, supportedReasoningEfforts: [{ reasoningEffort: "medium" }] })) }));
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
    setOutput: (fn: typeof output) => { output = fn; pendingOutput = null; },
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
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(2);
    expect(f.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(2);
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
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(2);
    expect(f.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(2);
    expect(JSON.stringify(f.harness.inspection.sdk.callsTo("threads.send"))).toContain("BLUE");
  });
  it("runs both participants even when the queued request uses B", async () => {
    const f = await setup(); f.entries[0].model = "b"; f.start();
    await eventually(() => f.entries[0].content.length === 2);
    const run = (await f.runs())[0]; expect(run.members?.map(m => m.advisor.model)).toEqual(["a", "b"]); expect(run.aggregator.model).toBe("b");
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
    await eventually(() => f.harness.inspection.sdk.callsTo("threads.stop").length === 2);
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
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(2);
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
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(2);
    expect(f.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(2);
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
    const pair = { ...config, a: { ...b, agentId: null }, b: a, timeoutSeconds: 300, enabled: false };
    await f.harness.behavior.callRpc("save", { threadId: "other", config: pair });
    expect((await f.harness.behavior.callRpc("status", { threadId: "parent" }) as { config: Config }).config).toEqual({ ...pair, enabled: true });
    expect((await f.harness.behavior.callRpc("draftDefaults", { projectId: "another-project" }) as { config: Config }).config).toEqual(pair);
    await f.harness.behavior.callRpc("toggle", { threadId: "parent", enabled: false });
    expect((await f.harness.behavior.callRpc("status", { threadId: "other" }) as { config: Config }).config).toEqual(pair);
  });
  it("discards legacy native profiles before first submission and never calls CLI Agents", async () => {
    const f = await setup(false); f.parent.environmentId = null;
    const { token } = await f.harness.behavior.callRpc("prepareDraft", { projectId: "project", config }) as { token: string };
    const updated = { ...config, b: { ...b, agentId: "researcher" } };
    await f.harness.behavior.callRpc("prepareDraft", { projectId: "another-project", config: updated });
    expect(await f.harness.behavior.callRpc("readDraft", { token })).toEqual({ ...updated, b: { ...updated.b, agentId: null } });
    f.harness.inspection.sdk.stub("plugins.callRpc", async () => ({ token: "11111111-1111-4111-8111-111111111111", label: "researcher" }));
    const base = f.context([text(`[bb-moa-draft:${token}]`)]);
    const ctx = { ...base, project: { ...base.project, id: "project" }, host: { ...base.host!, id: "host" } };
    expect((await f.hook()(ctx)).action).toBe("wait");
    f.start(); await eventually(() => f.entries[0].content.length === 2);
    expect((await f.runs())[0].members?.[1].advisor.agentId).toBeNull();
    const calls = JSON.stringify(f.harness.inspection.sdk.callsTo("plugins.callRpc"));
    expect(calls).toBe("[]");
    expect(JSON.stringify(f.harness.inspection.sdk.callsTo("threads.spawn"))).not.toContain("cli-agents-selection");
  });
  it("invalidates ready advice in another chat when the shared pair changes", async () => {
    const f = await setup(); f.start();
    await eventually(() => f.entries[0].content.length === 2);
    await f.harness.behavior.callRpc("save", { threadId: "other", config: { ...config, b: { ...b, serviceTier: "fast" } } });
    f.harness.inspection.sdk.stub("plugins.callRpc", async () => ({ token: "11111111-1111-4111-8111-111111111111", label: "researcher" }));
    expect(f.entries[0].content).toEqual([text("Question one")]);
    expect((await f.hook()(f.context())).action).toBe("wait");
    await eventually(async () => (await f.runs())[0]?.members?.[1].advisor.serviceTier === "fast" && f.entries[0].content.length === 2);
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
    expect(f.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(2);
  });
  it("lets the user cancel a long pending consultation without delivering late advice", async () => {
    const f = await setup(); f.worker.status = "pending"; f.worker.runtime.displayStatus = "pending";
    let now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now);
    f.start(); await eventually(async () => !!(await f.runs())[0]?.progress);
    now += 3600 * 1000;
    await eventually(async () => !!(await f.runs())[0]?.progress?.overdue);
    expect(f.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(0);
    await f.harness.behavior.callRpc("toggle", { threadId: "parent", enabled: false });
    await eventually(() => f.harness.inspection.sdk.callsTo("threads.stop").length === 2);
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

describe("independent participants and fallback", () => {
  it("starts both participants before either answers, and waits for both", async () => {
    const f = await setup();
    const releases = new Map<string, (value: { output: string }) => void>();
    f.harness.inspection.sdk.stub("threads.output", ({ threadId }: { threadId: string }) => new Promise(resolve => releases.set(threadId, resolve)));
    f.start(); await eventually(() => releases.size === 2);
    releases.get("worker-a")!({ output: "Independent answer A" });
    await eventually(async () => (await f.runs())[0]?.members?.[0].status === "ready");
    expect(f.entries[0].content).toHaveLength(1);
    expect((await f.hook()(f.context())).action).toBe("wait");
    releases.get("worker-b")!({ output: "Independent answer B" });
    await eventually(() => f.entries[0].content.length === 2);
    const reference = JSON.stringify(f.entries[0].content[1]);
    expect(reference).toContain("Independent answer A"); expect(reference).toContain("Independent answer B");
    expect((await f.hook()(f.context())).action).toBe("proceed");
  });
  it("retries only the failed participant, preserving the other answer", async () => {
    const f = await setup(); let recovered = false;
    f.harness.inspection.sdk.stub("threads.output", async ({ threadId }: { threadId: string }) => {
      if (threadId === "worker-b" && !recovered) throw new Error("rate limit");
      return { output: `Answer ${threadId}` };
    });
    f.start(); await eventually(async () => (await f.runs())[0]?.status === "failed");
    const failed = (await f.runs())[0];
    expect(failed.members?.map(m => m.status)).toEqual(["ready", "failed"]);
    recovered = true;
    await f.harness.behavior.callRpc("retry", { threadId: "parent", runId: failed.id });
    await eventually(() => f.entries[0].content.length === 2);
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(2);
    expect(f.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(1);
    expect(JSON.stringify(f.harness.inspection.sdk.callsTo("threads.send"))).toContain("worker-b");
    expect((await f.runs())[1].status).toBe("failed");
  });
  it("uses the configured reserve after a failure and retains the first attempt", async () => {
    const f = await setup();
    await f.harness.behavior.callRpc("save", { threadId: "parent", config: { ...config, failurePolicy: "reserve", reserve } });
    f.harness.inspection.sdk.stub("threads.output", async ({ threadId }: { threadId: string }) => {
      if (threadId === "worker-b") throw new Error("rate limit");
      return { output: `Answer ${threadId}` };
    });
    f.start(); await eventually(() => f.entries[0].content.length === 2);
    const member = (await f.runs())[0].members![1];
    expect(member.advisor.model).toBe("reserve"); expect(member.primaryAdvisor?.model).toBe("b");
    expect(member.attempts?.[0].status).toBe("failed"); expect(member.attempts?.[0].workerId).toBe("worker-b");
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(3);
    expect(JSON.stringify(f.entries[0].content[1])).toContain("Answer worker-reserve");
  });
  it("does not loop when the reserve also fails", async () => {
    const f = await setup();
    await f.harness.behavior.callRpc("save", { threadId: "parent", config: { ...config, failurePolicy: "reserve", reserve } });
    f.setOutput(async () => { throw new Error("unavailable"); });
    f.start(); await eventually(async () => (await f.runs())[0]?.status === "failed");
    await new Promise(r => setTimeout(r, 1100));
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(4);
    expect(f.entries[0].content).toHaveLength(1);
    expect((await f.runs())[0].members?.every(m => m.attempts?.length === 1)).toBe(true);
  });
  it("can continue a held failure with one answer only when explicitly configured", async () => {
    const f = await setup();
    f.harness.inspection.sdk.stub("threads.output", async ({ threadId }: { threadId: string }) => {
      if (threadId === "worker-b") throw new Error("rate limit");
      return { output: "Successful A" };
    });
    f.start(); await eventually(async () => (await f.runs())[0]?.status === "failed");
    expect(f.entries[0].content).toHaveLength(1);
    await f.harness.behavior.callRpc("save", { threadId: "parent", config: { ...config, failurePolicy: "available" } });
    await eventually(() => f.entries[0].content.length === 2);
    expect((await f.runs())[0].partial).toBe(true);
    const block = f.entries[0].content[1];
    expect(block.type === "text" && block.text).toContain('"missingParticipants":["B"]');
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(2);
  });
  it("holds the message if neither participant returns an answer", async () => {
    const f = await setup();
    await f.harness.behavior.callRpc("save", { threadId: "parent", config: { ...config, failurePolicy: "available" } });
    f.setOutput(async () => { throw new Error("rate limit"); }); f.start();
    await eventually(async () => (await f.runs())[0]?.status === "failed");
    expect(f.entries[0].content).toHaveLength(1);
  });
  it("manually replaces a silent participant without stopping its peer", async () => {
    const f = await setup();
    await f.harness.behavior.callRpc("save", { threadId: "parent", config: { ...config, failurePolicy: "wait", reserve } });
    const releases = new Map<string, (value: { output: string }) => void>();
    f.harness.inspection.sdk.stub("threads.output", ({ threadId }: { threadId: string }) => threadId === "worker-reserve" ? Promise.resolve({ output: "Reserve answer" }) : new Promise(resolve => releases.set(threadId, resolve)));
    f.start(); await eventually(() => releases.size === 2);
    await f.harness.behavior.callRpc("replaceParticipant", { threadId: "parent", runId: (await f.runs())[0].id, key: "b" });
    await eventually(async () => (await f.runs())[0]?.members?.[1].status === "ready");
    expect((await f.runs())[0].members?.[0].status).toBe("running");
    expect(JSON.stringify(f.harness.inspection.sdk.callsTo("threads.stop"))).not.toContain("worker-a");
    expect(f.entries[0].content).toHaveLength(1);
    releases.get("worker-a")!({ output: "Original A" });
    await eventually(() => f.entries[0].content.length === 2);
    releases.get("worker-b")!({ output: "Late discarded B" });
    expect(JSON.stringify(f.entries[0].content)).not.toContain("Late discarded B");
  });
  it("rejects a reserve that duplicates a participant", async () => {
    const f = await setup();
    await expect(f.harness.behavior.callRpc("save", { threadId: "parent", config: { ...config, failurePolicy: "reserve", reserve: a } })).rejects.toThrow("differ");
  });
});

describe("optional File Gateway integration", () => {
  it("rechecks gateway availability for reused sessions and preserves native mentions", async () => {
    const f = await setup(); let available = true;
    f.harness.inspection.sdk.stub("plugins.list", async () => ({ plugins: available ? [{ id: "file-gateway", enabled: true, status: "running" }] : [] }));
    const resource = { kind: "plugin" as const, pluginId: "file-gateway", itemId: 'files:remote-reference', label: 'Remote file' };
    f.entries[0].content = [{ type: "text", text: "Remote file", mentions: [{ start: 0, end: 11, resource }] }];
    f.start(); await eventually(() => f.entries[0].content.length === 2);
    expect((await f.runs())[0].members?.map(m => m.fileGateway)).toEqual([true, true]);
    const spawned = JSON.stringify(f.harness.inspection.sdk.callsTo("threads.spawn"));
    expect(spawned).toContain('files:remote-reference'); expect(spawned).toContain('bb file-gateway read');
    const first = f.entries[0]; f.entries = [];
    await f.harness.behavior.emitThreadEvent("message.dispatched", { entry: first });
    available = false; f.advanceParent();
    f.entries = [makeQueueEntry({ ...first, id: "q2", content: [text("Follow-up")], updatedAt: first.updatedAt + 1 })];
    await eventually(() => f.entries[0].content.length === 2);
    expect((await f.runs())[0].members?.map(m => m.fileGateway)).toEqual([false, false]);
    expect(f.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(2);
    expect(JSON.stringify(f.harness.inspection.sdk.callsTo("threads.send"))).toContain('Do not read external files');
  });
});


it("inherits each parent message's permission mode without widening manual approvals", async () => {
  for (const mode of ["full", "accept-edits"] as const) {
    const f = await setup(); f.entries[0].permissionMode = mode; f.start();
    await eventually(() => f.entries[0].content.length === 2);
    const calls = JSON.stringify(f.harness.inspection.sdk.callsTo("threads.spawn"));
    expect(calls).toContain(`"permissionMode":"${mode}"`);
    expect(calls).not.toContain(`"permissionMode":"${mode === "full" ? "accept-edits" : "full"}"`);
  }
});
