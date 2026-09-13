import { expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { advisorInput, hasFileGateway } from "../file-access";
import { fileAccessPolicy } from "../prompts";
import type { Input } from "../core";

it("enables external reads only for the running optional plugin", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "moa" });
  for (const [plugins, expected] of [
    [[], false],
    [[{ id: "file-gateway", enabled: false, status: "disabled" }], false],
    [[{ id: "file-gateway", enabled: true, status: "error" }], false],
    [[{ id: "file-gateway", enabled: true, status: "running" }], true],
    [[{ id: "other", enabled: true, status: "running" }], false],
  ] as const) {
    harness.inspection.sdk.stub("plugins.list", async () => ({ plugins }));
    expect(await hasFileGateway(bb)).toBe(expected);
  }
  harness.inspection.sdk.stub("plugins.list", async () => { throw new Error("discovery failed"); });
  expect(await hasFileGateway(bb)).toBe(false);
  await harness.lifecycle.dispose();
});
it("preserves exact native gateway sources without forwarding other plugin selections", () => {
  const resource = { kind: "plugin" as const, pluginId: "file-gateway", itemId: 'files:' + encodeURIComponent(JSON.stringify({ hostId: 'host_remote', path: '/home/user/file.md' })), label: "Server: file.md" };
  const original: Input = [{ type: "text", text: "Check the file", mentions: [
    { start: 0, end: 5, resource },
    { start: 0, end: 5, resource: { ...resource, pluginId: "moa", itemId: "draft:token" } },
    { start: 0, end: 5, resource },
  ] }];
  const result = advisorInput("Instructions", original, true);
  expect(result).toHaveLength(2);
  expect(result[1]).toEqual({ type: "text", text: resource.label, mentions: [{ start: 0, end: resource.label.length, resource }] });
  expect(advisorInput("Instructions", original, false)).toEqual([{ type: "text", text: "Instructions", mentions: [] }]);
  expect(original[0].type === "text" && original[0].mentions).toHaveLength(3);
});
it("provides a provider-independent CLI route and a fail-closed unavailable policy", () => {
  const enabled = fileAccessPolicy(true, "host_local");
  expect(enabled).toContain("bb file-gateway read");
  expect(enabled).toContain("exact hostId and path");
  expect(enabled).toContain("do not copy, write, upload");
  const disabled = fileAccessPolicy(false, "host_local");
  expect(disabled).toContain("Do not read external files");
  expect(disabled).toContain("host_local");
});
