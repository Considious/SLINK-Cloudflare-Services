# Backend and installer verification

Run `npm ci`, `npm test`, then `npm run check`. The last command is a package-only dry run, not a deployment. Tests use synthetic users, temporary/in-memory keys and local SQLite/workerd services.

## Results — 2026-10-31

**28/28 feature tests passed**, including real local Workers, SQLite Durable Objects and WebSockets. **18/18 existing contribution tests passed** after the isolated chat route hook was added. Wrangler successfully packaged the Worker in a dry run. Its attempted debug-log write outside the workspace was denied; that did not prevent packaging, and no deployment was made.

Coverage includes room permissions and timed restrictions; live-socket mute/unmute/revocation; same-account socket renewal; failed compound edit rollback; concurrent-safe registration and same-identity recovery; token/license/signature validation; request byte limits; two-node mutual linking, deduplication, forgery rejection, outage and revocation; and setup/upgrade identity preservation, private secret transfer, cancellation and failed-upload recovery.

The client batch adds **11 extension client/service tests and 4 PDA adapter/installer tests**, plus a real-client/Worker/SQLite/WebSocket round-trip script and a headless Chrome UI script. The latter checks narrow-screen bounds, safe text, retained focused draft, minimize/reopen, identity-checked last-room restoration, resumed media controls, mute, activity pause/resume, independent permission changes, preservation of unfinished room-name edits, immediate administration scrolling and unchanged native controls. Shared PDA mirrors are generated from the tested extension source. Extension manifest/source validation, background startup/dashboard-host checks, and existing PDA storage/activity/chat-window checks are also part of the local verification. These do not replace actual Torn-page or physical-device testing.

Client test commands are in the extension/PDA package scripts. The optional browser check requires Playwright plus a browser (`SLINK_BROWSER_PACKAGE` and `SLINK_BROWSER_EXECUTABLE` can point at existing installations). The server round-trip uses a local backend checkout with its installed dependencies; set `SLINK_NODE_TEST_ROOT` to that package folder if it is not at the default adjacent test-workspace location. It does not contact deployed services or use real conversations.

An additional test for a real isolated extension content script on a strict-CSP page is provided separately. Its Edge launch failed in the current environment before it could make a policy/origin assertion; this is recorded as **unverified**, not passed. The synthetic Chrome UI test does not cover that gap. Actual Torn and physical PDA acceptance remain mandatory.

This is not a penetration test or production acceptance. Registration uses real SQLite with a D1-shaped transactional adapter, not deployed D1 load tests. Real Worker tests caught both RPC Error-field loss and Cloudflare's unsupported `redirect:'error'`; those paths are corrected and exercised.

## Required before release

1. Deploy separate Central test infrastructure with migration 0023 and a dedicated test signing key. Exercise OAuth installation on a clean customer account and verify initial Leader, routing, bindings and renewal.
2. Exercise lost registration responses, expired-token recovery, failed D1 transactions and interrupted directory propagation.
3. Verify deployed hibernation/eviction/resume, deployment restart persistence, reconnect-resistant rate budgets, inactive-room retention deletion and measured usage.
4. Expand edit/reply/delete/moderator and federation load/error tests: retry exhaustion, missing/mismatched acknowledgements, concurrent duplicates, multiple links and outage revocation.
5. Exercise the integrated chat GUI/Leader interface on real extension/PDA installations. Check full page navigation and its documented page-local draft limitation, media-provider responses, themes, narrow screens, scroll/focus, account changes, native permissions, background ownership and Torn CSP.
6. Review billing/abuse exposure and privacy. Do not call this production-ready until these gates pass.

Keep user-facing checks in the single root `FACTION-NODE-TESTER-CHANGELOG.md`, not a history of internal batches.
