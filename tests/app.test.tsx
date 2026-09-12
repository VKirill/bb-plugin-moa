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
