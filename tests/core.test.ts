import { describe, it, expect } from "vitest";
import { advisorFor, boundedContext, cleanInput, referenceBlock, safeError, type Input } from "../core";
import { configSchema, type Slot } from "../contract";
const a: Slot = { providerId: "codex", model: "a", reasoningLevel: "medium", agentId: null };
const b: Slot = { ...a, model: "b" };
const config = configSchema.parse({ a, b, enabled: true });
describe("MoA policy", () => {
  it("uses the other model and preserves the current aggregator", () => {
    expect(advisorFor(config, a)).toEqual(b);
    expect(advisorFor(config, b)).toEqual(a);
    expect(advisorFor(config, { ...a, model: "c" })).toEqual(b);
  });
  it("compares provider/model IDs, not labels or effort", () => {
    expect(advisorFor(config, { ...b, reasoningLevel: "high" })).toEqual(a);
    expect(advisorFor(config, { ...b, providerId: "other" })).toEqual(b);
    expect(() => advisorFor({ ...config, b: { ...a, agentId: "reviewer" } }, a)).toThrow();
  });
  it("preserves user text, files, images and other plugins' context", () => {
    const input: Input = [
      { type: "text", text: "[bb-moa-reference:literal user text]", mentions: [] },
      { type: "image", url: "https://example.com/a.png" },
      { type: "localFile", path: "/a.pdf" },
      { type: "text", text: "Other plugin", mentions: [], visibility: "agent-only" },
    ];
    expect(cleanInput([...input, referenceBlock("r", b, "advice")])).toEqual(input);
  });
  it("bounds history with an explicit omission marker", () => {
    const result = boundedContext("a".repeat(100000));
    expect(result.length).toBeLessThanOrEqual(60000);
    expect(result).toContain("omitted");
  });
  it("does not persist exception payloads", () => {
    expect(safeError(new Error("Provider failure: secret-text"))).not.toContain("secret-text");
    expect(safeError(new Error("timeout: secret-text"))).not.toContain("secret-text");
  });
});
