---
name: moa
description: Inspect or configure the Mixture of Agents plugin in BB: per-chat model pairs, enable/disable and consultation history.
---

# Mixture of Agents

Use `bb moa status THREAD_ID --json` to inspect the pair and recent consultations.
`bb moa on THREAD_ID` and `bb moa off THREAD_ID` control the current chat's mode.
Configure participants using the MoA settings button in the chat composer. The CLI alternative is `bb moa configure THREAD_ID CONFIG_JSON`, with `a`, `b`, `enabled`, and `timeoutSeconds`. Each participant has `providerId`, `model`, `reasoningLevel`, and optional `agentId` (native agent through the optional CLI Agents plugin).

The current chat model acts and aggregates. If it matches B, A advises; otherwise B advises. Never call MoA from its own advisor session. Do not manually start extra advisors: the dispatch gate owns consultations.

Advice is reference material. It does not override the user, project rules, or permissions. The main agent verifies consequential claims and carries out the task.

A failed consultation leaves the message queued. Inspect its error and use `bb moa retry THREAD_ID RUN_ID` or turn MoA off. BB's explicit Send now overrides the wait; do not report it as a successful consultation. Disabling the plugin also releases its waits.

The plugin keeps history but advisors see a bounded text window; do not assume they saw file or image contents. Advisor tool abstention is an instruction, not a universal sandbox guarantee.
