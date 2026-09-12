// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Config } from "../contract";
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
const cleanups: (() => void)[] = [];
afterEach(() => { for (const clean of cleanups.splice(0)) clean(); });
const config: Config = {
  enabled: false, a: { providerId: "codex", model: "a", reasoningLevel: "medium", agentId: null },
  b: { providerId: "codex", model: "b", reasoningLevel: "medium", agentId: null }, timeoutSeconds: 120,
};
async function mount(fail = false) {
  const app = await loadPluginApp(() => import("../app"));
  let current = config;
  const slot = renderSlot(app.composerCustomizations[0].actions![0], {}, {
    composer: { scope: { kind: "thread", threadId: "parent" } },
    rpc: {
      status: () => ({ config: current, main: config.a, environmentId: "env", runs: [] }),
      toggle: (input: unknown) => {
        const { enabled } = input as { enabled: boolean };
        if (fail) throw new Error("Selection unavailable");
        current = { ...current, enabled }; return current;
      },
    },
  });
  cleanups.push(() => slot.lifecycle.unmount());
  const checkbox = await slot.findByRole("checkbox", { name: "MoA" });
  await waitFor(() => expect(checkbox.getAttribute("disabled")).toBeNull());
  return { slot, checkbox };
}
it("persists the checkbox through RPC for the current chat", async () => {
  const { slot, checkbox } = await mount();
  fireEvent.click(checkbox);
  await waitFor(() => expect(checkbox.getAttribute("aria-checked")).toBe("true"));
  expect(slot.inspection.rpcCalls).toContainEqual(expect.objectContaining({ method: "toggle", input: { threadId: "parent", enabled: true } }));
});
it("keeps MoA off and shows an error when enabling fails", async () => {
  const { slot, checkbox } = await mount(true);
  fireEvent.click(checkbox);
  await slot.findByRole("alert");
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
});
it("offers MoA in a new chat and carries its selection with the draft", async () => {
  const app = await loadPluginApp(() => import("../app"));
  expect(app.composerCustomizations[0].scopes).toContain("new-thread");
  const slot = renderSlot(app.composerCustomizations[0].actions![0], {}, {
    composer: { scope: { kind: "new-thread", projectId: "project" }, text: "First question", attachmentCount: 1 },
    rpc: {
      draftDefaults: () => ({ hostId: "host", config }),
      prepareDraft: () => ({ token: "11111111-1111-4111-8111-111111111111" }),
    },
  });
  cleanups.push(() => slot.lifecycle.unmount());
  fireEvent.click(await slot.findByRole("checkbox", { name: "MoA" }));
  const enable = await slot.findByRole("button", { name: "Enable for this chat" });
  fireEvent.click(enable);
  await waitFor(() => expect(slot.inspection.composer.mentions).toContainEqual({
    provider: "draft", id: "11111111-1111-4111-8111-111111111111", label: "MoA",
  }));
  expect(slot.inspection.composer.text).toContain("First question");
  expect(slot.inspection.composer.attachmentCount).toBe(1);
  expect(slot.inspection.composer.submits).toHaveLength(0);
});
