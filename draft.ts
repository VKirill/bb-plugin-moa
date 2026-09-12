import type { ComposerStructuredDraft, ComposerView } from "@get-bb/plugin-sdk/app";
let state: { projectId: string | null; draft: ComposerStructuredDraft } = { projectId: null, draft: { text: "", mentions: [] } };
const listeners = new Set<() => void>();
export const subscribeDraft = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getDraft = () => state;
export function observeDraft(draft: ComposerStructuredDraft, view: ComposerView) {
  if (view.scope.kind !== "new-thread") return;
  state = { projectId: view.scope.projectId, draft };
  for (const listener of listeners) listener();
}
export const moaMentions = (draft: ComposerStructuredDraft) => draft.mentions.filter(m => m.provider === "draft" && m.label === "MoA");
export function removeMoa(text: string, draft: ComposerStructuredDraft) {
  if (text !== draft.text) throw new Error("The draft is updating. Please try again.");
  for (const m of [...moaMentions(draft)].sort((a, b) => b.from - a.from)) text = text.slice(0, m.from) + text.slice(m.to);
  return text;
}
