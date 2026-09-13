import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const effortSchema = z.enum(["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]);
export const slotSchema = z.object({
  providerId: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(250),
  reasoningLevel: effortSchema.default("medium"),
  serviceTier: z.enum(["default", "fast"]).optional(),
  agentId: z.string().trim().max(200).nullable().default(null),
});
export type Slot = z.infer<typeof slotSchema>;
const rawConfigSchema = z.object({
  enabled: z.boolean().default(false),
  a: slotSchema,
  b: slotSchema,
  timeoutSeconds: z.number().int().min(30).max(900).default(240),
  failurePolicy: z.enum(["wait", "available", "reserve"]).optional(),
  reserve: slotSchema.nullable().optional(),
});
export type Config = z.infer<typeof rawConfigSchema>;
export const configSchema = rawConfigSchema.transform((config): Config => ({ ...config, a: { ...config.a, agentId: null }, b: { ...config.b, agentId: null },
  ...(config.reserve ? { reserve: { ...config.reserve, agentId: null } } : {}) }));
export const progressSchema = z.object({
  state: z.string(), observedAt: z.number(), lastEventAt: z.number().nullable(),
  lastEventType: z.string().nullable(), overdue: z.boolean(),
});
export const attemptSchema = z.object({
  advisor: slotSchema, workerId: z.string().nullable(),
  status: z.enum(["waiting", "running", "ready", "failed", "cancelled"]),
  startedAt: z.number().nullable(), finishedAt: z.number().nullable(),
  error: z.string().nullable(), advice: z.string().nullable(), fileGateway: z.boolean().optional(), progress: progressSchema.optional(),
});
export const memberSchema = attemptSchema.extend({
  key: z.enum(["a", "b"]), primaryAdvisor: slotSchema.optional(), attempts: z.array(attemptSchema).optional(),
});
export type MemberView = z.infer<typeof memberSchema>;
export const runSchema = z.object({
  id: z.string(), threadId: z.string(), workerId: z.string().nullable(),
  status: z.enum(["waiting", "running", "ready", "dispatched", "failed", "cancelled", "bypassed"]),
  advisor: slotSchema, aggregator: slotSchema,
  startedAt: z.number(), finishedAt: z.number().nullable(),
  error: z.string().nullable(), advice: z.string().nullable(),
  progress: progressSchema.optional(), members: z.array(memberSchema).optional(), partial: z.boolean().optional(),
});
export type RunView = z.infer<typeof runSchema>;
export const auditSchema = z.object({
  run: runSchema, canReplace: z.boolean().optional(), userInput: z.string(), advisorInput: z.string().nullable(),
  advisorRequestedAt: z.number().nullable(), advisorInputVerified: z.boolean(),
  mainInput: z.string().nullable(), mainRequestedAt: z.number().nullable(), mainInputVerified: z.boolean(),
  members: z.array(z.object({ member: memberSchema, input: z.string().nullable(), requestedAt: z.number().nullable(), inputVerified: z.boolean() })).optional(),
});
export type Audit = z.infer<typeof auditSchema>;
const threadInput = z.object({ threadId: z.string().min(1).max(200) });
export const rpcContract = defineRpcContract({
  messageIndex: {
    input: threadInput,
    output: z.array(z.object({ rowId: z.string(), runId: z.string(), sourceSeq: z.number() })),
  },
  audit: { input: threadInput.extend({ runId: z.string() }), output: auditSchema },
  replaceParticipant: { input: threadInput.extend({ runId: z.string(), key: z.enum(["a", "b"]) }), output: z.object({ ok: z.boolean() }) },
  draftDefaults: {
    input: z.object({ projectId: z.string().min(1) }),
    output: z.object({ hostId: z.string(), config: configSchema }),
  },
  prepareDraft: {
    input: z.object({ projectId: z.string().min(1), config: configSchema }),
    output: z.object({ token: z.string().uuid() }),
  },
  readDraft: {
    input: z.object({ token: z.string().uuid() }),
    output: configSchema,
  },
  status: {
    input: threadInput,
    output: z.object({ environmentId: z.string().nullable(), config: configSchema.nullable(), main: slotSchema, runs: z.array(runSchema) }),
  },
  save: { input: threadInput.extend({ config: configSchema }), output: configSchema },
  toggle: { input: threadInput.extend({ enabled: z.boolean() }), output: configSchema },
  retry: { input: threadInput.extend({ runId: z.string() }), output: z.object({ ok: z.boolean() }) },
  providers: {
    input: threadInput,
    output: z.array(z.object({ id: z.string(), name: z.string(), available: z.boolean() })),
  },
  models: {
    input: threadInput.extend({ providerId: z.string() }),
    output: z.array(z.object({ model: z.string(), name: z.string(), efforts: z.array(effortSchema) })),
  },
});
