# Changelog

All notable changes to PITI are documented here.

## [0.6.0] - 2026-03-27

### Reminders & Custom Rules
- **Scheduled reminders**: One-shot or recurring (daily, weekly, weekdays) with timezone support. ReminderService polls every 60s, fires due reminders through the dispatcher, and sends the agent's reply to Telegram.
- **Natural language reminders**: Say "remind me in 30 minutes" in conversation — the agent calls its native `create_reminder` tool and the gateway creates the DB record automatically.
- **`/reminders` command**: Multi-step creation flow with frequency picker, timezone selector, and time input. Paginated list with toggle/edit/delete buttons. Max 20 reminders per user.
- **User-defined skills**: Custom rules that shape agent behavior, injected as "User Rules" in system prompt. `/skills` command with full CRUD and pagination.

### Reliability
- **Per-user message queue**: Consecutive messages are now processed in serial order. Each message waits for the previous to complete, so the agent always sees updated conversation history.
- **Duplicate message guardrail**: Incoming messages are deduplicated by Telegram `message_id` (handles retries). Outgoing replies are deduplicated by hash within a 60s window.
- **Reply quoting**: Bot now quotes the original user message when replying via `reply_parameters`.
- **Rate limiter relaxed**: From 1 msg/2s (which dropped consecutive messages) to 20 msg/5s (anti-flood only).
- **Telegram bot menu**: `setMyCommands` registers all commands so they appear in the Telegram menu button.

## [0.5.0] - 2026-03-20

### RAG Memory & Automated Recaps
- **Semantic long-term memory**: Memories are now embedded using pgvector (text-embedding-3-small) and retrieved via cosine similarity search against the user's current message. The agent recalls relevant context from months ago, not just the 10 most recent facts.
- **Semantic deduplication**: New memories with >85% similarity to existing ones update the original instead of creating duplicates.
- **Automated recaps**: Daily conversation summaries generated at midnight. Weekly recaps on Mondays, monthly on the 1st — all stored as embedded memories.
- **Memory deletion**: New `/forget` command with paginated memory list (10 per page with navigation buttons). Reply with a number to delete specific memories, or `/forget all` to wipe everything.
- **Reset clears everything**: `/reset` now deletes both conversation history AND all memories. Settings are preserved.

### Agent Architecture
- **Externalized prompts**: Agent soul and personality prompts moved from hardcoded TypeScript to `agents/personal-trainer/` folder with SOUL.md and personality markdown files. Gateway loads labels and descriptions from JSON config files.
- **Generic agent platform**: All "coach"/"trainer" references removed from gateway code. The platform is now agent-agnostic — specific personality only lives in the agent folder.
- **Status ping**: Gateway sends heartbeat to billing service every 60s with active container count.
- **Status page**: New `/status` page on the website showing real-time system health.
- **Guide page**: New `/guide` page with commands reference, capabilities docs, and credit costs.

## [0.4.0] - 2026-03-19

### Agent Customization
- **Character personalities**: 6 coach personalities — Balanced Coach, Drill Sergeant, Best Friend, The Scientist, Zen Master, Hype Coach. Each with distinct communication style enforced via system prompt.
- **Custom agent name**: `/name` command lets users name their agent (max 30 chars).
- **Onboarding flow**: `/start` now chains language → character picker (with translated preview + confirm/back) → name prompt.
- **Translated UI**: Character labels, descriptions, and all bot messages translated in 6 languages (EN, IT, ES, FR, DE, PT).
- **Character enforcement**: Personality section moved to top of system prompt with "never break character" instruction. Verified with real LLM integration tests.

### Message Context
- **Timestamps**: User messages include send timestamps in LLM context (as system notes, not in message content) so the agent understands time gaps between sessions.
- **Daily date broadcast**: System message injected at midnight for all users with current date and day of week.
- **Current date/time** in system prompt header.

## [0.3.0] - 2026-03-19

### Billing & Referrals
- **Coupon system**: `/redeem` command with custom coupon codes, max uses, and optional `requireSubscription` flag.
- **Referral system**: Share `t.me/piti_ai_bot?start=ref_CODE` links. Both parties earn +15 credits on signup, referrer gets +50 on subscription.
- **Subscription management**: `/subscription` command with Stripe billing portal integration, plan switching, and cancellation.

### Security
- **14 vulnerability fixes** across gateway, agent, and infrastructure.
- **Input sanitization**: Prompt injection prevention in router classification and memory extraction.
- **Auth middleware**: Optional Telegram user whitelist.

## [0.2.0] - 2026-03-18

### Core Platform
- **Per-user Docker containers**: Each user gets an isolated agent container with auto-scaling and idle timeout.
- **Two-tier LLM routing**: Cheap classifier (Gemini Flash) → smart model (Gemini Pro) for complex queries.
- **Off-topic guard**: Regex heuristics + LLM classification to block jailbreaks and off-topic requests.
- **MCP integration**: DuckDuckGo search via MCP bridge for web research with source citations.
- **Media handling**: Photo analysis (form check, meal estimation) and video frame extraction via ffmpeg.
- **Multi-language**: Auto-detect user language, enforce response language. 6 languages supported.
