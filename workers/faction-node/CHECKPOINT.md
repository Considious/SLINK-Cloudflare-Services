# Faction Node checkpoint

Updated 2026-10-31. Unreleased feature: do not merge/deploy main. Branch `feature/faction-node-v1` exists in Cloudflare Services, Browser Extension and Torn-Scripts. Client branches still have no feature edits.

## Fixed agreement

Customer-owned Worker and SQLite Durable Objects, one room/object, hibernating WebSockets, no chat polling. Separate faction license `slink.chat`; explicit Leaders represent `slink.chat.leader`. Existing `slink.qol.chat` does not license/administer hosted rooms. Own themed rooms/buttons must integrate into Torn's actual chat GUI without replacing native chat. Leaders assign readers/speakers/moderators, temporary grants/blocks and timed/permanent mutes.

## Implemented backend/setup

- Worker routing; SQLite room history, replies, edits/deletion/moderation, compact read cursors, transient presence/typing and Leader diagnostics.
- Central registry migration 0023 and isolated contribution route hook. Concurrent-safe registration, same-identity retry, dedicated ES256 keys, discovery, bounded-freshness access tokens, certificate renewal and revocation.
- Serialized directory writes reload persisted state on failure. A durable pending-propagation list repairs interrupted room synchronization. Explicit RPC error envelopes retain intended status codes.
- Per-operation/recipient permissions, existing-socket updates/revocation and mute-expiry notifications. Same-account socket `auth` renewal does not rebuild a window.
- Persisted admission/action budgets survive reconnect; indexed retention with oldest-message expiry alarms rounded to the next hour; no idle polling loop.
- Mutual link approval, isolated secrets, deduplication, bounded acknowledged delivery and unlinking. Local sending survives remote outages.
- Wrangler OAuth setup/upgrade wizard, persistent node identity, hidden one-use token, secret upload over stdin, endpoint/certificate confirmation, settings/routes/migration preservation and retry recovery.
- README, security, architecture, cost estimate and testing docs. One user-facing checklist: root `FACTION-NODE-TESTER-CHANGELOG.md`.

## Checks completed

28 feature tests pass, including real local Worker/SQLite/WebSocket flows and two linked nodes. All 18 existing contribution tests pass. Wrangler package-only dry run succeeded; no deployment. Its outside-workspace log write was denied, not bundling. Deployment/physical-device/load checks remain explicit gates in TESTING.md and SECURITY.md.

## Next task — do not repeat completed work

Build shared client, Torn chat-bar windows and explicit Leader interface, then integrate extension/PDA.

1. Reuse verified permission sessions, existing theme tokens and media picker/renderer. Discover endpoints, keep access tokens in memory, share renewal across rooms.
2. Extension transport must respect Torn CSP via its background architecture and active-tab ownership. PDA follows its active-page lifecycle. No hidden-page scraping, full-document scan timer or native-chat transport interception.
3. User-supplied stable anchors: `#chatRoot`, `people_panel_button`, `slink_extension_chat_button`, `notes_settings_button`, `chat_panel_button:faction`. Current bottom row/window-container classes are `root___Ef1Ql`/`root___PF7AM`. Synthetic fixtures only; do not retain private messages from supplied HTML.
4. Administration needs a roster-name picker, clear room access modes, duration choices, early unmute/unblock, moderators/Leaders, invitation review/approval and diagnostics. Backend is authoritative.
5. Patch messages by ID/revision; preserve drafts, focus and scroll across auth refresh. Do not overwrite `src/core/faction-chat.js`, which is an unrelated Torn-message composer helper.
6. Complete deployment, security/load, expanded failure recovery and physical-device gates before general release.

Use internal GitHub tools, never shell Git/gh. Node/npm/local tests are allowed. Node 22.13+, lockfile-pinned tools. Never commit private config, node_modules or generated bundles.

One-year node identity certificates are not a live revocation list. Central revocation stops new tokens/discovery/renewal; existing access expires within five minutes of identity verification. Leaders sever their own links immediately. Do not claim instant global certificate revocation.
