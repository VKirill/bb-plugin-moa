# Mixture of Agents (MoA) for BB — Parallel Dual-Model Advisory, Resilient Fallback & History

[![BB Compatibility](https://img.shields.io/badge/BB-%3E%3D0.43.1-blue.svg)](https://getbb.app)
[![Plugin SDK](https://img.shields.io/badge/Plugin%20SDK-%3E%3D0.4.87-green.svg)](https://getbb.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/VKirill/bb-plugin-moa?include_prereleases&color=orange)](https://github.com/VKirill/bb-plugin-moa/releases)

> Two independent AI models analyze each message in parallel. Your current chat model receives both answers, evaluates them, and performs the task with greater precision. MoA adds a compact per-chat toggle, shared model settings, configurable fallback, and per-message consultation history.

**Status:** 0.1.0-beta.8 · experimental. **License:** MIT. **Requires:** BB 0.43.1 and Plugin SDK 0.4.87. Uses public plugin APIs: no BB core patches, private imports, separate API keys or global CLI configuration changes.

## Use

1. Open a new or existing chat.
2. Click the **MoA** chip in the composer (the whole chip opens settings, like the model picker).
3. Choose two different provider/model combinations, A and B. BB's picker also selects reasoning and supported service tier.
4. Save and enable MoA. Models, fallback and the long-wait notice threshold are shared across all chats and projects; the checkbox stays local to each chat. In a new chat, the first-message selection is carried in hidden draft metadata; the checkbox is the visible control. Each normal submission waits for both participants before the original request and private reference context reach your current agent.
5. Uncheck MoA to resume ordinary delivery. Re-enabling continues saved advisor history and supplies intervening conversation updates.

Both selected participants run even when the main chat uses one of their models. Each has a separate persistent session. MoA does not select native agents/profiles or add CLI Agents selection markers; legacy profile settings are ignored.

The MoA chip lives in BB's composer action row (before voice/send). It is not duplicated above a collapsed phone composer. English/Russian copy follows the BB interface language, or a one-click Auto / English / Русский override in plugin settings. MoA is off until a pair is configured and explicitly enabled in that chat.

Hover a user message delivered through MoA and click its Workflow icon to open the consultation modal. The **This message** tab shows the user request, actual advisor input, advisor answer and confirmed acting-model input. Separate **Session A/B** tabs embed the native BB transcripts without a composer. Existing settings history also links to this modal, with retries for failures. Workers are hidden from the sidebar; their runtime is stopped after each consultation and their history retained.

## Delivery and history

```text
MoA on:  user message → parallel A + B consultations → current agent + both answers → answer/actions
MoA off: user message → current agent → answer/actions
```

The main chat is canonical. Advisors receive bounded text updates, including decisions made while MoA was disabled. Their prior proposals are not treated as accepted decisions. Sessions are keyed by chat, environment, participant configuration and prompt version.

The coordinator uses `message.dispatch`, BB's durable queue, an optimistic queue update and `agent-only` input. It checks the consultation fingerprint before attaching advice. Editing/cancelling invalidates old answers. Failed consultations remain visible and block subsequent MoA work in the same chat until retried, cancelled or disabled. A reload does not blindly replay an uncertain billable request.

Plugin state and consultation records use the plugin's SQLite database in BB-managed storage. Provider messages use ordinary BB thread storage. Exception bodies and prompts are not written to plugin logs.

## Boundaries

- **BB's explicit Send now is an override:** it bypasses dispatch hooks and can send without advice. MoA records this as bypassed. Disabling/uninstalling the plugin also releases BB's plugin-held waits. This is not an unbypassable provider-level interceptor.
- Consultation runs once per user submission, not every internal tool iteration. It increases latency and provider usage.
- Advisors may inspect relevant local files and, when File Gateway is running, remote files through its hosts/list/read operations. Writes, uploads, copies, project execution and unrelated actions remain prohibited by role instructions. Native provider capabilities still exist: this is **not a universal read-only sandbox**. File Gateway enforces its own access policy.
- Initial context is a bounded recent window: up to 50 timeline segments, trimmed to 60,000 characters. Long histories may be incomplete.
- Original files, images and mentions are preserved for the main agent. Advisors receive labelled attachment references; file contents are read on demand, not automatically injected. When File Gateway is running, its native mentions are forwarded intact through BB, preserving exact source identity. Other plugin selection mentions are not forwarded. Image pixels are not automatically supplied.
- A and B must have different provider/model IDs. Changing a slot's effort or service tier creates its own advisory session.
- New chats can opt in before the first message. Selection belongs to the draft, not all tabs or future chats. Unchecking MoA returns that draft to ordinary mode. A lifecycle-scoped content script hides only the plugin's native draft chip; other mentions are unaffected (verified against BB 0.43.1). Side-chat composers do not opt in.
- Before the main workspace exists, the first advisor runs in the project checkout on the machine resolved from the actual submission (a personal workspace only for an unfiled chat). Its thread is retained after the main workspace is provisioned. This requires an existing host and a project source on that host. The main workspace selection is preserved, including a separately requested worktree.
- The new-chat picker discovers models using the project's default machine (or BB primary machine for an unfiled chat); the advisor model is validated on the actual submission machine before launch. Shared settings are offered with MoA off for each new chat.

## Message history

Receipt confirmation matches the complete private reference against BB's recorded outgoing request, including thread and run identity; identical question text is never used to join histories. Reused advisor sessions are matched by consultation time, not their latest response. The per-message button appears only on verified MoA user messages. Visibility decorates BB 0.43.1 native `data-timeline-row-id` anchors through a lifecycle-scoped content script because SDK message actions currently have no availability predicate. Recheck this adapter on a BB upgrade; settings history remains available independently.

The lookup scans the latest 500 outgoing user requests in each involved thread. Audit display caps advisor input at 150,000 and acting-model input at 200,000 characters. Missing retained events are reported as unavailable; prepared input is not labelled delivered. Native session history can contain previous consultations; the message tab isolates the selected one.

## Long consultations

`timeoutSeconds` is retained for compatibility but now means the **long-wait notice threshold**, not an active-model deadline. The coordinator observes the native thread/runtime state and latest event every three seconds. The history panel shows elapsed time, state and latest event time; the composer adds a waiting notice after the threshold.

Active, starting, pending, reconnecting and queued/background work is allowed to continue beyond the threshold, including silent reasoning. MoA accepts a fresh answer after the worker is idle with no queued or background-agent work. Explicit provider errors surface as failures; an idle worker with no new answer after the threshold also fails. Missing progress text alone does not establish a hang. BB/provider watchdogs retain their own behavior.

Users can disable MoA, cancel the queued message or explicitly Send now. Changing the notice threshold keeps the current consultation running. Changing the shared pair invalidates pending advice; plugin reload currently interrupts running consultations and requires an explicit retry. Do not reload during live advisory work.

## Optional File Gateway

MoA checks `bb.sdk.plugins.list` before each participant attempt. External reads are permitted only when plugin ID `file-gateway` is enabled and running. Absence, disabled/error state or discovery failure selects an explicit local-only policy; MoA continues without a hard dependency or auto-installation.

Advisors use the native `bb_file_gateway` tool, or the public `bb file-gateway hosts|list|read` CLI if their provider does not expose that tool. Source IDs and paths are preserved by forwarding native gateway mentions in BB input blocks; MoA does not decode gateway IDs, import its internals or bypass its resolver. The same route supports other enrolled BB hosts and gateway-configured website sources. Reads honor the gateway's permissions and limits. No SSH/HTTP/alternative-connector fallback is allowed when gateway access fails.

Advisors inherit the original queued message's BB permission mode; manual approvals are not silently widened. In manual mode a provider may wait for approval before a gateway command.

Each attempt records whether File Gateway was available; this appears in the consultation modal. Actual reads and results remain in its native session transcript. Availability is not proof of a successful read. Reused sessions receive the current policy on every question, including after installation/removal of the optional plugin; old session history is retained. No host IDs, file paths or credentials are hard-coded in the package.

## Fallback

The existing MoA settings dialog includes **If a participant fails**. These settings are shared across chats:

- `failurePolicy: "wait"` (default): keep the message queued for a manual retry, cancellation or mode change.
- `failurePolicy: "reserve"`: use the selected `reserve` model once for each failed participant. It must differ from A and B. A working peer continues; its completed answer is preserved. Failure of the reserve keeps the message queued.
- `failurePolicy: "available"`: wait for all still-working participants and proceed with one successful answer if the other failed. The main model and history explicitly report the missing participant. If both fail, remain queued.

A configured reserve can also replace an active participant manually from the consultation modal. The button explicitly stops that participant and starts the reserve; no silence timer automatically cancels active reasoning. Prior attempt transcripts remain available. Retry keeps completed peer answers and repeats only failed participants. Each participant/reserve combination has a separate session.

Old consultations retain the original one-advisor record and are labelled historical. Multi-advisor references are persisted exactly for durable delivery verification.

## Install from a checkout

```sh
npm ci
bb plugin build
bb plugin install . --yes
```

After edits, build and run `bb plugin reload moa`. To unload: `bb plugin disable moa`. Removing the plugin removes its state; saved BB worker threads remain ordinary threads that can be archived or deleted.

## CLI

```sh
bb moa status THREAD_ID --json
bb moa on THREAD_ID
bb moa off THREAD_ID
bb moa retry THREAD_ID RUN_ID
bb moa configure THREAD_ID '{"enabled":false,"a":{"providerId":"codex","model":"MODEL_A","reasoningLevel":"medium"},"b":{"providerId":"codex","model":"MODEL_B","reasoningLevel":"medium"},"timeoutSeconds":240}'
```

Use IDs from the live picker. Legacy `agentId` is accepted for compatibility and normalized to null. `serviceTier` may be `default` or `fast` where supported. CLI status is bounded and omits original prompt content; the UI displays stored advice, capped at 32,000 characters per participant.

## Development

```sh
npm ci
npm run check
bb plugin types --check
```

Tests use official BB backend/frontend harnesses and temporary SQLite. See [verification](docs/verification.md) and [release preparation](docs/releasing.md).

Standalone plugin source: no machine paths, credentials or chat artifacts belong in the package. Distribution contains server/app bundles and BB compatibility metadata. GitHub releases are published at https://github.com/VKirill/bb-plugin-moa/releases. Community Marketplace acceptance is a separate review.

Inspired by [Hermes MoA](https://hermes-agent.nousresearch.com/docs/user-guide/features/mixture-of-agents); implementation and prompts are original. See [NOTICE](NOTICE).

## Tags & Ecosystem
`bb`, `bb-plugin`, `moa`, `mixture-of-agents`, `multi-agent`, `ai-advisor`, `parallel-inference`, `llm`, `consensus`, `developer-tools`

