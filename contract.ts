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
export const configSchema = z.object({
  enabled: z.boolean().default(false),
  a: slotSchema,
  b: slotSchema,
  timeoutSeconds: z.number().int().min(30).max(900).default(240),
});
export type Config = z.infer<typeof configSchema>;
export const runSchema = z.object({
  id: z.string(), threadId: z.string(), workerId: z.string().nullable(),
  status: z.enum(["waiting", "running", "ready", "dispatched", "failed", "cancelled", "bypassed"]),
  advisor: slotSchema, aggregator: slotSchema,
  startedAt: z.number(), finishedAt: z.number().nullable(),
  error: z.string().nullable(), advice: z.string().nullable(),
  progress: z.object({
    state: z.string(), observedAt: z.number(), lastEventAt: z.number().nullable(),
    lastEventType: z.string().nullable(), overdue: z.boolean(),
  }).optional(),
});
export type RunView = z.infer<typeof runSchema>;
const threadInput = z.object({ threadId: z.string().min(1).max(200) });
const agentCatalog = z.object({
  supported: z.boolean(), warnings: z.array(z.string()),
  agents: z.array(z.object({ id: z.string(), description: z.string() })),
});
export const rpcContract = defineRpcContract({
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
  agents: { input: threadInput.extend({ providerId: z.string() }), output: agentCatalog },
});
