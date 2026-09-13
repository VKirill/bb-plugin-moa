import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Input } from "./core";

export async function hasFileGateway(bb: BbPluginApi, signal?: AbortSignal) {
  try {
    const { plugins } = await bb.sdk.plugins.list({ signal });
    return plugins.some(plugin => plugin.id === "file-gateway" && plugin.enabled && plugin.status === "running");
  } catch { return false; }
}

// Preserve native references: BB, not MoA, resolves and checks the source.
// Do not forward other plugin mentions (especially MoA draft/profile markers).
export function advisorInput(prompt: string, original: Input, gateway: boolean): Input {
  const result: Input = [{ type: "text", text: prompt, mentions: [] }];
  if (!gateway) return result;
  const seen = new Set<string>();
  for (const block of original) {
    if (block.type !== "text") continue;
    for (const mention of block.mentions ?? []) {
      const resource = mention.resource;
      if (resource.kind !== "plugin" || resource.pluginId !== "file-gateway" || seen.has(resource.itemId)) continue;
      seen.add(resource.itemId);
      result.push({ type: "text", text: resource.label,
        mentions: [{ start: 0, end: resource.label.length, resource }] });
    }
  }
  return result;
}
