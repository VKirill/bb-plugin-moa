import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { memberSchema, runSchema, type Audit } from "./contract";
import { runReference, textOf, type Input } from "./core";
import type { Store, Run } from "./store";

type Event = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>>[number];
type RequestEvent = Extract<Event, { type: "client/turn/requested" }>;
const isRequest = (row: Event): row is RequestEvent => row.type === "client/turn/requested";
function inputText(input: readonly Input[number][]) {
  return input.map(block => block.type === "text" ? block.text : textOf([block])).join("\n\n");
}
function clip(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit)}\n[Display truncated after ${limit} characters.]` : text;
}

export function createAudit(bb: BbPluginApi, store: Store) {
  async function requests(threadId: string) {
    const result: RequestEvent[] = [];
    let beforeSeq: string | undefined;
    for (let page = 0; page < 5; page++) {
      const rows = await bb.sdk.threads.events.list({ threadId, types: ["client/turn/requested"], order: "desc", limit: "100", ...(beforeSeq ? { beforeSeq } : {}) });
      result.push(...rows.filter(isRequest));
      if (rows.length < 100) break;
      const next = String(Math.min(...rows.map(row => row.seq)));
      if (next === beforeSeq) break;
      beforeSeq = next;
    }
    return result;
  }
  function runFromRequest(row: RequestEvent): Run | null {
    for (const block of row.data.input) {
      if (block.type !== "text" || block.visibility !== "agent-only") continue;
      const id = block.text.match(/^\[bb-moa-reference:([0-9a-f-]{36})\]/)?.[1];
      const run = id ? store.get<Run>(`run:${id}`) : null;
      if (run?.threadId === row.threadId && run.advice
        && block.text === (runReference(run) as { text: string }).text) return run;
    }
    return null;
  }
  return {
    async messageIndex(threadId: string) {
      return (await requests(threadId)).flatMap(row => {
        const run = runFromRequest(row);
        return run ? [{ rowId: `${threadId}:user-seed:${row.seq}`, sourceSeq: row.seq, runId: run.id }] : [];
      });
    },
    async detail(threadId: string, runId: string): Promise<Audit> {
      const run = store.get<Run>(`run:${runId}`);
      if (!run || run.threadId !== threadId) throw new Error("Consultation not found in this chat.");
      const members = run.members ?? [{ key: "b" as const, advisor: run.advisor, workerId: run.workerId,
        status: run.advice ? "ready" as const : run.status === "failed" ? "failed" as const : "running" as const,
        startedAt: run.startedAt, finishedAt: run.finishedAt, error: run.error, advice: run.advice, advisorInput: run.advisorInput }];
      const [mainRows, ...memberRows] = await Promise.all([
        requests(threadId), ...members.map(member => member.workerId ? requests(member.workerId) : Promise.resolve([])),
      ]);
      const memberDetails = members.map((member, i) => {
        const row = memberRows[i].filter(row => row.createdAt >= (member.startedAt ?? run.startedAt)
          && row.createdAt <= (member.finishedAt ?? run.finishedAt ?? Date.now())).sort((a, b) => a.seq - b.seq)[0];
        return { member: memberSchema.parse(member), input: row ? clip(inputText(row.data.input), 150000) : member.advisorInput ?? null,
          requestedAt: row?.createdAt ?? null, inputVerified: !!row };
      });
      const main = mainRows.find(row => runFromRequest(row)?.id === run.id);
      const advisor = memberDetails[0];
      return {
        run: runSchema.parse(run), userInput: textOf(run.input.filter(b => b.visibility !== "agent-only")),
        advisorInput: advisor?.input ?? null,
        advisorRequestedAt: advisor?.requestedAt ?? null, advisorInputVerified: advisor?.inputVerified ?? false,
        mainInput: main ? clip(inputText(main.data.input), 200000) : null,
        mainRequestedAt: main?.createdAt ?? null, mainInputVerified: !!main, members: memberDetails,
      };
    },
  };
}
