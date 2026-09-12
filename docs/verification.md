# Verification: 0.1.0-beta.1

Checked on 2026-09-13 with BB 0.43.1, Plugin SDK 0.4.87 and Node on macOS arm64.

## Automated checks

- `npm run check`: TypeScript, all 20 tests and server/frontend bundles passed.
- `bb plugin types --check`: installed SDK pin matches 0.4.87.
- Clean source copy: `npm ci --omit=dev` followed by `bb plugin build` passed. Git installations can build without development dependencies.
- Package allowlist includes bundles and compatibility metadata, original prompts, skill, license and documentation. Tests, node_modules and private chat artifacts are excluded.

The official SDK harness tests dispatch gating, forged markers, recursion prevention, session reuse, role reversal, failure handling, stale edits, cancellation/bypass, off-mode cleanup, durable reload state, explicit retry, per-chat FIFO, and frontend toggling/error feedback. An early bypass cancellation race was found and fixed; the regression now passes. A reload test initially needed its fake-host SDK stubs restored after reload; that fixture was corrected.

## Live checks

A hidden, isolated chat used Codex Luna/Sol with low reasoning. Seven consultations completed and their private reference blocks appeared in BB's outbound request events. Main/advisor timelines contained assistant responses and reasoning, with no tool-call items.

- Sol advised Luna; the next question reused the Sol worker.
- Changing the main model to Sol selected Luna as advisor.
- Disabling MoA delivered the next message normally, with no reference block.
- Re-enabling reused the advisor and supplied the intervening conversation.
- Browser composer submissions verified the checkbox and user-message delivery.
- A user correction made with MoA off was remembered by both advisor and main agent after re-enabling, then again after plugin reload. The same advisor thread was reused.
- Russian desktop settings rendered with the native model picker and optional CLI Agents catalog. Test workers were stopped and archived after verification.

One earlier probe sent a fact change through `bb thread tell`, which BB labels as an **agent** message. After reload the main model returned the original user's fact despite receiving the advisor's updated fact. The outbound event confirmed correct delivery. Repeating the scenario using actual browser **user** submissions passed before and after reload, without a code change. The exact model decision in the earlier probe is not established; MoA does not guarantee agreement or factual accuracy.

## Remaining scope

Other providers, actual native-profile execution and compact-device interaction need separate live validation. Their UI/catalog integration and SDK contracts are present. Send-now bypass, failure/retry and stale edits have harness coverage; the live probes focused on normal delivery, role changes, history and reload.

The build printed an unrelated existing custom ACP configuration warning on the test host, while returning success and generating all bundles. This plugin does not alter ACP configuration.

These checks establish a local beta, not marketplace acceptance or compatibility with future BB versions.

## 0.1.0-beta.2 — first-message support

Checked on 2026-09-13: TypeScript, 27 tests and build passed. Added coverage for
new-composer selection with attachments preserved, binding configuration before
first dispatch, another project/token-free draft isolation, retaining the worker
after main provisioning, defaults without a project source, and disabling MoA
when the first workspace is unavailable. Draft tokens are persisted and scoped
to the receiving chat; a retried initial marker cannot re-enable a disabled mode.

In a real browser, the new-chat checkbox opened the model-pair dialog and added
its MoA mention to the draft. The first user request remained queued while the
advisor ran; its private advice was present in the main model's first outbound
request. The main model replied FIRST-READY. A user follow-up reused the same
advisor and both answered COBALT. The checkbox remained enabled in the created
chat. Browser computed styles confirmed a 12 px checkbox and 12 px label.

The initial live attempt failed because BB permits personal workspaces only in
the personal project. This was corrected to use the standard project's source
on the actual submission host; the original queued first request then succeeded
on explicit retry. These initial failures remain in the consultation history.
No main turn was dispatched before successful consultation. Test chats were
stopped and archived afterward.

First-message native-profile execution and creating a new machine are outside
this beta's verified scope. The first advisor uses a source checkout and text
context, while the main agent keeps the user's requested workspace. No separate
worktree is created just for the advisor.
