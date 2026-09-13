---
name: moa
description: Inspect or configure the Mixture of Agents plugin in BB: shared model pairs, enable/disable and consultation history.
---

# Mixture of Agents

Use `bb moa status THREAD_ID --json` to inspect the pair and recent consultations.
`bb moa on THREAD_ID` and `bb moa off THREAD_ID` control the current chat's mode.
Models, fallback and the long-wait notice threshold are shared across all chats/projects. Enabling remains per-chat. Configure participants using the MoA settings button in the chat composer. The CLI alternative is `bb moa configure THREAD_ID CONFIG_JSON`, with `a`, `b`, `enabled`, and `timeoutSeconds`. Each participant has `providerId`, `model`, `reasoningLevel`, and optional `serviceTier`. Legacy `agentId` values are ignored; MoA never inserts CLI Agents selection markers.

Both A and B independently advise in parallel. The current chat model receives both answers and acts. Never call MoA from its own advisor session. Do not manually start extra advisors: the dispatch gate owns consultations.

Advice is reference material. It does not override the user, project rules, or permissions. The main agent verifies consequential claims and carries out the task.

A failed consultation leaves the message queued. Inspect its error and use `bb moa retry THREAD_ID RUN_ID` or turn MoA off. BB's explicit Send now overrides the wait; do not report it as a successful consultation. Disabling the plugin also releases its waits.

The plugin keeps history but advisors see a bounded text window; do not assume they saw file or image contents. Advisors may inspect relevant local files. If File Gateway is enabled and running, they may use its native tool or public CLI for hosts/list/read. No copies, writes, uploads, policy changes or SSH/HTTP bypass. Without the optional plugin, external reads are prohibited; continue with explicit missing evidence. These role restrictions are not an OS sandbox.

In a new-chat composer, enable MoA and choose the pair before sending. Hidden draft metadata binds MoA to the first message; the checkbox is the visible control. Unchecking removes that metadata. Before the main workspace exists the advisor uses the project source on the resolved existing host (personal workspace only for an unfiled chat).

`timeoutSeconds` is a notice threshold. Active/starting/pending or queued/background work continues beyond it. Status includes native runtime state, latest event time and an overdue flag; inspect advisor history for blockers. Silent reasoning is not proof of a hang. Explicit errors or an idle session without a fresh answer can fail. Cancel or disable explicitly when needed; do not reload the plugin during live advisory work.

Hover a user message sent through MoA and open its Workflow action to inspect the consultation modal. It shows exact request/context, advisor output and the actual acting-model input; the separate Advisor session tab embeds the full native timeline without a composer. Matching uses request sequence/run identity, never question text. The audit scans the latest 500 outgoing requests per thread; lack of an event is not proof of delivery.

Fallback is in the existing settings dialog and shared globally. `failurePolicy` is `wait` (default), `reserve` (one reserve attempt for a failed participant), or `available` (proceed with one ready answer after the other fails). `reserve` is a separate provider/model/reasoning slot, distinct from A/B. Both failing keeps the message queued. A working participant is never cancelled automatically for silence. With a reserve configured, the consultation modal can explicitly stop and replace one active participant. Retry reuses the ready peer answer. Old one-advisor runs are labelled historical; new runs show separate A/B and prior-attempt sessions.

File Gateway availability is checked for every participant attempt and recorded in history. Its native mentions preserve exact source IDs and paths through BB resolution. Do not infer that a file was read from capability availability; check actual session tool results. Gateway access policy remains authoritative.

Advisor permission mode inherits the originating message. Respect provider approval requests in manual mode; do not auto-approve or broaden the mode to avoid a wait.
