# Mixture of Agents for BB

Consult a second model before each message, then let your current chat agent act and answer. MoA adds a per-chat checkbox, a native model-pair picker, automatic advisor-role switching, and persistent consultation history.

**Status:** 0.1.0-beta.2 · experimental. **License:** MIT. **Requires:** BB 0.43.1 and Plugin SDK 0.4.87. Uses public plugin APIs: no BB core patches, private imports, separate API keys or global CLI configuration changes.

## Use

1. Open a new or existing chat.
2. Click the settings button next to **MoA** in the composer.
3. Choose two different provider/model combinations, A and B. BB's picker also selects reasoning and supported service tier.
4. Save and enable MoA. In a new chat, a **MoA** chip is added to this draft; keep it with the first question. Each normal submission waits for the advisor before the original request and private reference context reach your current agent.
5. Uncheck MoA to resume ordinary delivery. Re-enabling continues saved advisor history and supplies intervening conversation updates.

If the current model matches B, A advises. Otherwise B advises. The current model remains the aggregator and keeps its native agent identity. Optional per-slot agent/profile selections apply when that slot serves as advisor and require the separate **CLI Agents** plugin.

Desktop uses BB's action slot before voice/send; compact composers get a control above the input. English/Russian copy follows browser language. MoA is off until a pair is configured and explicitly enabled in that chat.

The settings dialog shows recent consultations, outputs and links to advisor histories, with retries for failures. Workers are hidden from the sidebar; their runtime is stopped after each consultation and their history retained.

## Delivery and history

```text
MoA on:  user message → queued consultation → current agent + advice → answer/actions
MoA off: user message → current agent → answer/actions
```

The main chat is canonical. Advisors receive bounded text updates, including decisions made while MoA was disabled. Their prior proposals are not treated as accepted decisions. Sessions are keyed by chat, environment, participant configuration and prompt version.

The coordinator uses `message.dispatch`, BB's durable queue, an optimistic queue update and `agent-only` input. It checks the consultation fingerprint before attaching advice. Editing/cancelling invalidates old answers. Failed consultations remain visible and block subsequent MoA work in the same chat until retried, cancelled or disabled. A reload does not blindly replay an uncertain billable request.

Plugin state and consultation records use the plugin's SQLite database in BB-managed storage. Provider messages use ordinary BB thread storage. Exception bodies and prompts are not written to plugin logs.

## Boundaries

- **BB's explicit Send now is an override:** it bypasses dispatch hooks and can send without advice. MoA records this as bypassed. Disabling/uninstalling the plugin also releases BB's plugin-held waits. This is not an unbypassable provider-level interceptor.
- Consultation runs once per user submission, not every internal tool iteration. It increases latency and provider usage.
- Advisors are instructed not to use tools or perform actions. Native sessions still have provider capabilities: this is an advisory role, **not a universal read-only sandbox**. The main agent retains its normal permissions.
- Initial context is a bounded recent window: up to 50 timeline segments, trimmed to 60,000 characters. Long histories may be incomplete.
- Original files, images and mentions are preserved for the main agent. Advisors get text and labelled attachment references; they do not automatically inspect file contents or image pixels.
- Role switching compares exact provider/model IDs. Two profiles of the same model do not form a pair. Changing a slot's profile, effort or service tier creates its own advisory session.
- CLI Agents is optional and provider-dependent. Live model routing/session reuse has been checked with Codex Luna/Sol; other providers need their own login and validation.
- New chats can opt in before the first message. Selection belongs to the draft, not all tabs or future chats. Removing the MoA chip or unchecking MoA returns that draft to ordinary mode. Side-chat composers do not opt in.
- Before the main workspace exists, the first advisor runs in the project checkout on the machine resolved from the actual submission (a personal workspace only for an unfiled chat). Its thread is retained after the main workspace is provisioned. This requires an existing host and a project source on that host. The main workspace selection is preserved, including a separately requested worktree.
- The new-chat picker discovers models using the project's default machine (or BB primary machine for an unfiled chat); the advisor model is validated on the actual submission machine before launch. Native advisor profiles can be selected after the main workspace exists. The last saved pair is offered as a preset, with MoA off.

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

Use IDs from the live picker. `agentId` is optional. `serviceTier` may be `default` or `fast` where supported. CLI status is bounded and omits original prompt content; the UI displays stored advice, capped at 32,000 characters per consultation.

## Development

```sh
npm ci
npm run check
bb plugin types --check
```

Tests use official BB backend/frontend harnesses and temporary SQLite. See [verification](docs/verification.md) and [release preparation](docs/releasing.md).

Standalone plugin source: no machine paths, credentials or chat artifacts belong in the package. Distribution contains server/app bundles and BB compatibility metadata. Repository/npm/marketplace publication is a separate step.

Inspired by [Hermes MoA](https://hermes-agent.nousresearch.com/docs/user-guide/features/mixture-of-agents); implementation and prompts are original. See [NOTICE](NOTICE).
