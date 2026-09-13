# Mixture of Agents

Two independent advisors analyze each request in parallel; your current BB model aggregates their answers and performs the task.

- Compact checkbox in new and existing chats.
- Shared model, reasoning and fallback settings; per-chat enabling.
- Reserve model, continuation with one answer, or manual retry on failure.
- Native BB activity monitoring; active models survive long-wait notices.
- Small message action opens formatted inputs, answers and delivery confirmation.
- Separate persistent A/B sessions and retained reserve-attempt transcripts.
- Optional File Gateway integration: advisors read relevant remote files themselves, using the exact source and native access policy.
- Existing BB providers and subscriptions; no native profile injection.

Beta for BB 0.43.1 / SDK 0.4.87. BB's explicit Send now can override the wait. See README for verified scope and limitations.
