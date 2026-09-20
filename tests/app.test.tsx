// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, mountPluginContentScripts, renderSlot } from "@get-bb/plugin-sdk/testing/app";
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
  const toggle = await slot.findByRole("button", { name: "MoA" });
  return { slot, toggle };
}
it("persists the composer toggle through RPC for the current chat", async () => {
  const { slot, toggle } = await mount();
  fireEvent.click(toggle);
  fireEvent.click(await slot.findByLabelText("Enable MoA for this chat"));
  await waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("true"));
  expect(slot.inspection.rpcCalls).toContainEqual(expect.objectContaining({ method: "toggle", input: { threadId: "parent", enabled: true } }));
});
it("keeps MoA off and shows an error when enabling fails", async () => {
  const { slot, toggle } = await mount(true);
  fireEvent.click(toggle);
  fireEvent.click(await slot.findByLabelText("Enable MoA for this chat"));
  await slot.findByRole("alert");
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
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
  fireEvent.click(await slot.findByRole("button", { name: "MoA" }));
  const enable = await slot.findByRole("button", { name: "Enable for this chat" });
  fireEvent.click(enable);
  await waitFor(() => expect(slot.inspection.composer.mentions).toContainEqual({
    provider: "draft", id: "11111111-1111-4111-8111-111111111111", label: "MoA",
  }));
  expect(slot.inspection.composer.text).toContain("First question");
  expect(slot.inspection.composer.attachmentCount).toBe(1);
  expect(slot.inspection.composer.submits).toHaveLength(0);
});

it("hides only the MoA draft chip and removes its styling on disposal", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const scripts = await mountPluginContentScripts(app, { pluginId: "moa", generation: 1 });
  const own = document.createElement("span"), other = document.createElement("span");
  own.dataset.promptMentionResource = JSON.stringify({ pluginId: "moa", itemId: "draft:token" });
  other.dataset.promptMentionResource = JSON.stringify({ pluginId: "cli-agents", itemId: "draft:token" });
  document.body.append(own, other);
  try {
    expect(getComputedStyle(own).display).toBe("none");
    expect(getComputedStyle(other).display).not.toBe("none");
    await scripts.lifecycle.dispose();
    expect(document.querySelector('style[data-bb-moa="draft-marker"]')).toBeNull();
  } finally { own.remove(); other.remove(); await scripts.lifecycle.dispose(); }
});

it("opens an exact message consultation in a modal and exposes the advisor session", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const history = await import("../history");
  const scripts = await mountPluginContentScripts(app, { pluginId: "moa", generation: 3 });
  const row = document.createElement("div"); row.dataset.timelineRowId = "parent:user-seed:10";
  const button = document.createElement("button"); button.setAttribute("aria-label", history.HISTORY_TITLE); row.append(button); document.body.append(row);
  const plain = document.createElement("button"); plain.setAttribute("aria-label", history.HISTORY_TITLE); document.body.append(plain);
  const run = { id: "run", threadId: "parent", workerId: "worker", status: "dispatched", advisor: config.a, aggregator: config.b,
    startedAt: 1000, finishedAt: 2000, advice: "Check the costs", error: null };
  const slot = renderSlot(app.appOverlays[0], {}, { context: { threadId: "parent", projectId: "project" }, rpc: {
    messageIndex: () => [{ rowId: "parent:user-seed:10", sourceSeq: 10, runId: "run" }],
    audit: () => ({ run, userInput: "My exact question", advisorInput: "Actual advisor context", advisorInputVerified: true,
      advisorRequestedAt: 1100, mainInput: "Question + Check the costs", mainInputVerified: true, mainRequestedAt: 2000 }),
  } });
  cleanups.push(() => { history.showAudit(null); slot.lifecycle.unmount(); row.remove(); plain.remove(); void scripts.lifecycle.dispose(); });
  await waitFor(() => expect(getComputedStyle(button).display).toBe("inline-flex"));
  expect(getComputedStyle(plain).display).toBe("none");
  await act(async () => { await app.messageActions[0].run({ threadId: "parent", message: { id: "parent:user-seed:10", threadId: "parent", role: "user", text: "Same text", sourceSeqEnd: 10 }, openPanel: () => false }); });
  await slot.findByRole("dialog", { name: history.HISTORY_TITLE });
  await slot.findByText("My exact question");
  await slot.findByText("Check the costs");
  await slot.findByText("Delivery confirmed");
  expect(slot.inspection.rpcCalls).toContainEqual(expect.objectContaining({ method: "audit", input: { threadId: "parent", runId: "run" } }));
  fireEvent.click(slot.getByRole("button", { name: "Advisor session" }));
});

it("decodes legacy and multi-participant payloads for readable Markdown", async () => {
  const { readablePayload } = await import("../history");
  expect(readablePayload('[bb-moa-reference:run]\n' + JSON.stringify({ advice: '## Heading\n\n**Important**' }))).toBe('\n## Heading\n\n**Important**');
  const formatted = readablePayload(JSON.stringify({ advisors: [{ model: 'A', advice: 'First\n\n- Item' }, { model: 'B', advice: 'Second' }] }));
  expect(formatted).toContain('### A\n\nFirst\n\n- Item'); expect(formatted).toContain('### B\n\nSecond');
  expect(formatted).not.toContain('\\n');
});

it("registers a settings language section", async () => {
  const app = await loadPluginApp(() => import("../app"));
  expect(app.settingsSections?.[0]?.id ?? app.settingsSections?.at?.(0)).toBeTruthy();
  const section = (app as { settingsSections?: { id: string }[] }).settingsSections?.[0]
    ?? (app as { slots?: unknown }).slots;
  expect(JSON.stringify(app)).toContain("language");
});

it("keeps MoA in the action row instead of a compact banner above the composer", async () => {
  const app = await loadPluginApp(() => import("../app"));
  expect(app.composerCustomizations[0].banners ?? []).toEqual([]);
});

it("opens settings from the composer chip without enabling MoA", async () => {
  const { slot, toggle } = await mount();
  fireEvent.click(toggle);
  await slot.findByRole("dialog", { name: "Mixture of Agents" });
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
});
it("saves fallback from the existing MoA settings dialog", async () => {
  const app = await loadPluginApp(() => import("../app"));
  let saved = config;
  const slot = renderSlot(app.composerCustomizations[0].actions![0], {}, {
    composer: { scope: { kind: "thread", threadId: "parent" } },
    rpc: { status: () => ({ config: saved, main: config.a, environmentId: "env", runs: [] }),
      agents: () => ({ supported: false, agents: [], warnings: [] }),
      save: (input: unknown) => { saved = (input as { config: Config }).config; return saved; } },
  });
  cleanups.push(() => slot.lifecycle.unmount());
  fireEvent.click(await slot.findByRole("button", { name: "MoA" }));
  const policy = await slot.findByRole("combobox", { name: "Fallback policy" });
  fireEvent.change(policy, { target: { value: "available" } });
  fireEvent.click(slot.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saved.failurePolicy).toBe("available"));
});
