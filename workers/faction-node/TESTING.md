# Backend and installer verification

Run `npm ci`, `npm test`, then `npm run check`. The last command is a package-only dry run, not a deployment. Tests use synthetic users, temporary/in-memory keys and local SQLite/workerd services.

## Results — 2026-10-31

**28/28 feature tests passed**, including real local Workers, SQLite Durable Objects and WebSockets. **18/18 existing contribution tests passed** after the isolated chat route hook was added. Wrangler successfully packaged the Worker in a dry run. Its attempted debug-log write outside the workspace was denied; that did not prevent packaging, and no deployment was made.

Coverage includes room permissions and timed restrictions; live-socket mute/unmute/revocation; same-account socket renewal; failed compound edit rollback; concurrent-safe registration and same-identity recovery; token/license/signature validation; request byte limits; two-node mutual linking, deduplication, forgery rejection, outage and revocation; and setup/upgrade identity preservation, private secret transfer, cancellation and failed-upload recovery.

This is not a penetration test or production acceptance. Registration uses real SQLite with a D1-shaped transactional adapter, not deployed D1 load tests. Real Worker tests caught both RPC Error-field loss and Cloudflare's unsupported `redirect:'error'`; those paths are corrected and exercised.

## Required before release

1. Deploy separate Central test infrastructure with migration 0023 and a dedicated test signing key. Exercise OAuth installation on a clean customer account and verify initial Leader, routing, bindings and renewal.
2. Exercise lost registration responses, expired-token recovery, failed D1 transactions and interrupted directory propagation.
3. Verify deployed hibernation/eviction/resume, deployment restart persistence, reconnect-resistant rate budgets, inactive-room retention deletion and measured usage.
4. Expand edit/reply/delete/moderator and federation load/error tests: retry exhaustion, missing/mismatched acknowledgements, concurrent duplicates, multiple links and outage revocation.
5. Complete the Torn chat GUI, Leader interface and extension/PDA integration. Check safe rendering, narrow screens, scroll/drafts/focus, themes, account/page changes, background ownership, Torn CSP and physical PDA devices.
6. Review billing/abuse exposure and privacy. Do not call this production-ready until these gates pass.

Keep user-facing checks in the single root `FACTION-NODE-TESTER-CHANGELOG.md`, not a history of internal batches.
