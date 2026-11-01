# Faction Node checkpoint

Updated 2026-10-31. Unreleased feature: do not merge/deploy main. Work is published on `feature/faction-node-v1` in Cloudflare Services, Browser Extension and Torn-Scripts. No live service deployment has been performed.

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

39 feature tests pass, including real local Worker/SQLite/WebSocket flows and two linked nodes. Eleven added fault/SQLite tests cover interrupted saves, retry-safe room creation, ephemeral typing/flood rejection, moderation/replies, serialized delivery, bounded retries, idle retention and duplicate remote events. All 18 existing contribution tests passed during backend integration. The earlier Wrangler package-only dry run succeeded; no deployment. Its outside-workspace log write was denied, not bundling. Deployment/physical-device/load checks remain explicit gates in TESTING.md and SECURITY.md.

## Client/UI completed locally

- Shared state/client, Torn chat-row launcher/window and Leader interface are implemented. Extension and PDA have separate platform adapters; their client/UI/settings code mirrors match through the explicit sync utility.
- Optional QOL Faction Rooms toggle starts off, saves independently, and exists in the extension dashboard too. Existing settings are not reset. API/session integration reuses the established permission service/native PDA JSON transport.
- State reconciliation, acknowledgement-aware edits/deletes, retry-safe pending messages, bounded reconnect, socket renewal, active-page gating, retained focused draft and account-change clearing have local coverage.
- Last room/management view and open/minimized state persist as small identity-bound UI preferences, not a large cache save. Actual conversation contents, unsent text and credentials are not persisted there. Draft text remains within the current page.
- Leader controls include named-member selection, independent read/send/moderator settings, timed grants/mutes/blocks, Leader assignment, room creation/archive, verified invitation review/approval, unlink and diagnostics.
- Themes reuse tokens/background assets. GIF/sticker selection reuses the existing picker and media URL resolver. Minimize/focus return resumes the picker instead of leaving it suspended.
- Dedicated PDA `SLINK_PDA_Faction_Node_Test.user.js` follows the feature branch with a separate runtime cache. The normal launcher remains on main; do not run both simultaneously.
- Local tests: 13 extension client/service cases, 4 PDA adapter/installer cases, real client/server SQLite/WebSocket integration, headless Chrome UI checks (including retried room creation), and PDA storage/lifecycle/write-isolation checks. Earlier extension manifest/background/dashboard-host checks passed during integration. Backend is now 39 passing tests.
- Hardening complete locally: room creation receipts prevent duplicates after a lost save acknowledgement; typing is coalesced with no database writes; concurrent delivery tasks share an attempt; reconnect limits survive brief connection flaps, rate limits impose a cooldown, and manual reconnect cancels the old scheduled retry. Shared PDA sources and its feature installer were rebuilt. No unrelated modules, main branches or live deployments changed.

## Next task — deployment and acceptance, not rebuilding the same client

Owner approved a separate Cloudflare test Worker/database for faction **46978**, with initial Chat Leader **3853023**. Do not grant chat administration through `admin.*`. Room administration already uses the explicit node Leader list; Central licensing requires the exact faction `slink.chat` grant, not a wildcard bypass. Added regressions exercise a wildcard-admin non-Leader, the explicit Leader without admin scopes, and rejection after removing the faction license. Central's existing `admin.*` requirement for issuing setup tokens is provisioning authority, not room membership or Leader authority. No production permission behavior was changed.

Owner is performing dashboard actions manually. Created D1 slink-faction-chat-test (9a10280e-47d7-4a43-aff9-7eca42f12b6c), placeholder slink-chat-central-test, its PERMISSIONS_DB binding and CHAT_CENTRAL_ISSUER text variable, and placeholder slink-faction-node-46978-test, all under richard-johnson554.workers.dev. Test-specific source configuration, minimal generated database SQL (no admin grant), isolated Central entry point and 3 passing setup checks are now prepared. See TEST-DEPLOYMENT.md for exact settings and remaining sequence. SQL execution/source deployment/secrets/token/node registration/client targeting are NOT yet confirmed. Never copy production private signing/session secrets into the test environment as a shortcut.

The dashboard reported the parent folder's generic wrangler.jsonc name mismatch despite the custom deploy configuration. Test Central now has a dedicated root `workers/faction-node/test-central` with its own standard wrangler.jsonc. Use the updated build/deploy commands in TEST-DEPLOYMENT.md. Do NOT rename the generic faction-node Worker config or accept Cloudflare's automatic rewrite. This fixes configuration discovery, not an application permission failure.

1. Provision/authorize a separate Central test deployment/database/key and a customer test node. The new `/api/chat/*` routes are NOT live. Existing client constants currently target the established Central origin; test-environment targeting/auth must be configured coherently before online testing. Do not simply push this into main to make the routes appear.
2. Validate actual isolated extension WebSocket origin/CSP and physical PDA native requests/WebSockets. The ordinary Chrome UI test passed; the additional isolated-extension probe could not start Edge under the local environment (crash-handler/browser launch failure), so that policy result is unverified. No bypass or periodic network keepalive was added.
3. Exercise deployed hibernation, clean-account installer/upgrade, interrupted saves, retention, load/abuse/billing, full Torn navigation and real provider media responses. Review terms/privacy for the new faction-owned chat before production.
4. Follow TESTING.md/SECURITY.md gates. The UI fixture uses the supplied Torn anchor structure but does not prove actual Torn layout. No additional DOM elements are currently needed unless deployed/device behavior differs.

## Deferred request

Optional Discord-channel bridging is requested for later. The bot is NOT implemented now. Require explicit room/channel approval, private customer-side credentials, clear external-sharing disclosure, independent identities, deduplication/loop prevention and moderation/access enforcement. See ARCHITECTURE.md; the current protocol is not falsely presented as already supporting Discord users.

Use internal GitHub tools, never shell Git/gh. Node/npm/local tests are allowed. Node 22.13+, lockfile-pinned tools. Never commit private config, node_modules or generated bundles.

One-year node identity certificates are not a live revocation list. Central revocation stops new tokens/discovery/renewal; existing access expires within five minutes of identity verification. Leaders sever their own links immediately. Do not claim instant global certificate revocation.
