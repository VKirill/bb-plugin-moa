import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Config, Slot } from "./contract";
import { AGGREGATOR_PROMPT } from "./prompts";

export type Input = Parameters<BbPluginApi["sdk"]["threads"]["send"]>[0]["input"];
export const MARKER = "[bb-moa-reference:";
export function cleanInput(input: readonly Input[number][]): Input {
  return input.filter(b => !(b.type === "text" && b.visibility === "agent-only" && b.text.startsWith(MARKER)));
}
export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const sameModel = (a: Slot, b: Slot) => a.providerId === b.providerId && a.model === b.model;
export function advisorFor(config: Config, main: Slot): Slot {
  if (sameModel(config.a, config.b)) throw new Error("Choose two different provider/model combinations.");
  return sameModel(main, config.b) ? config.a : config.b;
}
export function referenceBlock(runId: string, advisor: Slot, advice: string): Input[number] {
  return {
    type: "text", mentions: [], visibility: "agent-only",
    text: `${MARKER}${runId}]\n${AGGREGATOR_PROMPT}\nAdvisor: ${advisor.providerId}/${advisor.model}\n${JSON.stringify({ advice })}`,
  };
}
export function textOf(input: readonly Input[number][]): string {
  return cleanInput(input).map(b => {
    if (b.type === "text") return b.text;
    if (b.type === "image") return "[An image is attached to the original request.]";
    if (b.type === "localImage") return `[Image attachment: ${b.path}; not visually inspected by the advisor.]`;
    return `[File attachment: ${b.path}; its contents have not been inspected by the advisor.]`;
  }).join("\n\n");
}
export function boundedContext(text: string, max = 60000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, 6000)}\n[Older context omitted to fit the advisory budget.]\n${text.slice(-(max - 6200))}`;
}
export function safeError(error: unknown): string {
  // Never persist a provider exception body: it can contain the prompt or credentials.
  const text = error instanceof Error ? error.message : String(error);
  if (/stopped without a final answer/i.test(text)) return "Advisor stopped without a final answer. Inspect its history, then retry or turn MoA off.";
  if (/timeout|timed out/i.test(text)) return "Advisor timed out. Retry or turn MoA off to send normally.";
  if (/rate.?limit|quota/i.test(text)) return "Advisor reached a provider limit. Retry later or turn MoA off.";
  if (/abort|cancel/i.test(text)) return "Consultation cancelled.";
  if (/not available|unavailable|auth|credential/i.test(text)) return "Advisor provider, model or agent is unavailable. Check the selection and login.";
  return "Consultation could not complete. Check the selected model and provider, then retry.";
}
