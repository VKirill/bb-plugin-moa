import { afterEach, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createAudit } from "../audit";
import { createStore, type Run } from "../store";
import { referenceBlock } from "../core";
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of disposers.splice(0)) await fn(); });
function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "moa" });
  disposers.push(() => harness.lifecycle.dispose());
  const store = createStore(bb);
  const slot = { providerId: "codex", model: "a", reasoningLevel: "medium" as const, agentId: null };
  const first: Run = { id: "11111111-1111-4111-8111-111111111111", threadId: "parent", workerId: "worker", status: "dispatched",
    advisor: slot, aggregator: { ...slot, model: "b" }, startedAt: 1000, finishedAt: 1500, error: null, advice: "First advice",
    input: [{ type: "text", text: "Same question", mentions: [] }], queueId: "q1", revision: 1, fingerprint: "one" };
  const second: Run = { ...first, id: "22222222-2222-4222-8222-222222222222", startedAt: 2000, finishedAt: 2500, advice: "Second advice" };
  for (const run of [first, second]) store.put(`run:${run.id}`, "parent", "run", run);
  const request = (threadId: string, seq: number, createdAt: number, input: unknown[]) => ({ threadId, seq, createdAt, type: "client/turn/requested", data: { input } });
  const events = {
    parent: [request("parent", 40, 2500, [...second.input, referenceBlock(second.id, slot, second.advice!)]),
      request("parent", 20, 1800, [{ ...referenceBlock(first.id, slot, first.advice!), visibility: undefined }]),
      request("parent", 10, 1500, [...first.input, referenceBlock(first.id, slot, first.advice!)])],
    worker: [request("worker", 22, 2001, [{ type: "text", text: "Second context", mentions: [] }]),
      request("worker", 1, 1001, [{ type: "text", text: "First context", mentions: [] }])],
  };
  harness.inspection.sdk.stub("threads.events.list", async ({ threadId, limit, beforeSeq }: { threadId: keyof typeof events; limit: string; beforeSeq?: string }) => {
    if (Number(limit) > 100) throw new Error("Thread event limit cannot exceed 100");
    return (events[threadId] ?? []).filter(row => !beforeSeq || row.seq < Number(beforeSeq)).sort((a, b) => b.seq - a.seq).slice(0, Number(limit));
  });
  return { audit: createAudit(bb, store), first, second, events, store };
}
it("binds history to actual outgoing requests, not identical question text or user-written markers", async () => {
  const f = setup();
  expect(await f.audit.messageIndex("parent")).toEqual([
    { rowId: "parent:user-seed:40", sourceSeq: 40, runId: f.second.id },
    { rowId: "parent:user-seed:10", sourceSeq: 10, runId: f.first.id },
  ]);
  const first = await f.audit.detail("parent", f.first.id);
  expect(first.advisorInput).toBe("First context");
  expect(first.mainInput).toContain("First advice");
  expect(first.mainInput).not.toContain("Second advice");
  expect(first.mainInputVerified).toBe(true);
  expect((await f.audit.detail("parent", f.second.id)).advisorInput).toBe("Second context");
});
it("does not claim delivery when only prepared input or a saved answer exists", async () => {
  const f = setup(); f.events.parent = []; f.events.worker = [];
  f.store.put(`run:${f.first.id}`, "parent", "run", { ...f.first, advisorInput: "Prepared context" });
  const result = await f.audit.detail("parent", f.first.id);
  expect(result.advisorInput).toBe("Prepared context");
  expect(result.advisorInputVerified).toBe(false);
  expect(result.mainInputVerified).toBe(false);
  expect(result.mainInput).toBeNull();
});
it("refuses a consultation id from another chat", async () => {
  const f = setup(); await expect(f.audit.detail("other", f.first.id)).rejects.toThrow("not found");
});

it("pages past 100 newer requests within BB's native event limit", async () => {
  const f = setup();
  for (let i = 0; i < 100; i++) f.events.parent.push({ threadId: "parent", seq: 100 + i, createdAt: 3000 + i,
    type: "client/turn/requested", data: { input: [{ type: "text", text: "ordinary request" }] } });
  expect((await f.audit.messageIndex("parent")).map(row => row.sourceSeq)).toEqual([40, 10]);
});
