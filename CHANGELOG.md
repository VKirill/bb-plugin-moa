# 0.1.0-beta.9

- Open the MoA settings sheet through BB's `DialogTrigger` / `MobileTrigger`, the same path Agency uses: on a phone the keyboard is blurred on click, not mousedown, so the first tap is not lost in an empty chat.

# 0.1.0-beta.8

- Open MoA settings from the whole composer chip through the same overlay trigger as BB's model picker, so the first click is not swallowed by a nested button or a disabled loading state.
- Add English/Russian UI with Auto / English / Русский in plugin settings.

# 0.1.0-beta.6

- Allow advisors to inspect relevant local files and use the optional File Gateway for external reads.
- Detect enabled/running File Gateway before each attempt, including reused sessions and fallback. Missing/disabled/unhealthy gateway keeps consultations in local-only mode.
- Preserve native gateway file mentions via BB input blocks, keeping exact sources and paths without importing gateway internals.
- Support native tools and the public CLI across providers. Keep write/copy/configuration and bypass operations prohibited.
- Inherit the queued message's permission mode instead of forcing manual command approvals on advisors.
- Record gateway availability per attempt; actual tool reads remain visible in the participant transcript.

# 0.1.0-beta.5

- Run both configured participants independently in parallel, then deliver both references to the acting chat model.
- Add shared fallback settings: manual decision, one reserve attempt, or continuation with a single successful answer. Manual replacement stops only the selected participant; retries preserve the ready peer.
- Show a small Workflow action only under verified MoA user messages; remove the expanded composer status badge.
- Format both history views with native Markdown, including decoded legacy JSON payloads. Keep separate A/B and failed-attempt transcripts.
- Fix event-history HTTP 400 by requesting pages of at most 100 events.
- Remove native agent/profile selectors and CLI Agents marker injection; ignore saved profile selections.
- Preserve legacy one-advisor history and exact new private references for delivery verification.

# Changelog

## 0.1.0-beta.4

- Per-message MoA history action opens an in-app modal for the selected consultation.
- Inspect actual advisor input, answer, confirmed acting-model receipt and the native advisor transcript.
- Show participating model icons/names inside the consultation modal; keep the composer compact.
- Match historical consultations by outgoing reference and request sequence, including reused advisor sessions.


## 0.1.0-beta.3

- Shared model/profile pair and wait-notice threshold across chats/projects; per-chat enabling and separate histories.
- Hide the initial draft chip while preserving its structured routing metadata.
- Observe native BB runtime/events and display long-wait progress; no hard timeout for working advisors, including silent reasoning.
- Preserve shared native profiles in first-message routing.


## 0.1.0-beta.2

- Enable MoA in a new-chat composer before the first submission.
- Draft-bound selection survives native submission and cannot enable another project or tab.
- Bootstrap advisor on the selected machine and reuse its history after main workspace provisioning.
- Smaller 12 px composer label and checkbox.

## 0.1.0-beta.1

- Per-chat MoA control for desktop and compact composers.
- Model pair with automatic advisor-role switching and optional native profiles.
- Durable consultation gate, private advice and persistent sessions.
- Visible failures, retries, cancellation and normal-mode restoration.
- English/Russian UI, public-SDK tests and release packaging.
