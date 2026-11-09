# Ranked Gear worker (preview source)

This worker archives only confirmed, sold ranked-gear auctions from Torn API v2. Repeated pages and subsequent resales are distinguished by auction ID. The scheduled collector processes bounded daily windows and resumes from its D1 checkpoint. It excludes buyer and seller data from the archive.

The live path refreshes one shared R2 snapshot, checking armor and melee before secondary and primary. Each partition has a price ceiling and a five-page limit (20 Weaver reads total per refresh). HTTP 429 stops the scan and backs off. A capped or partly failed snapshot is marked incomplete. The default rate is the lowest observed ask on the official Torn Item Market response for Small Arms Cache (item 1120) divided by 20. The shared scan defaults to 90% of that valuation; optional Worker variables LIVE_SCAN_MAX_PERCENT, LIVE_SCAN_MAX_BB_RATE and LIVE_SCAN_MAX_PRICE control coverage. A personal watch's budget, class, rarity and perk count filter the shared results without triggering additional Weaver reads. Manual rates outside snapshot coverage report partial results.

Tester checklist (Extension and PDA): Select only Small weapons and verify there are no heavy or melee matches; repeat for Melee and Armor. Set a budget below a previously listed match and verify it disappears. Select a rarity and a single perk count and check each result against the native listing. Check that partial coverage is visible and that capped matches retain the proper rarity and perk count. Open a matching ranked weapon in a bazaar and verify that SLINK Buy offers its Yes overlay only when Torn's confirmation identifies the same roll, quantity 1, and the expected total. No purchase is necessary. Identical visible rolls must not be highlighted; Item Market and armor purchase controls are not covered by this bazaar weapon fixture.

Live samples confirmed no Weaver key is required. Weaver reports the equipment slot as `weaponType`, numeric stats as strings, keyed bonus objects, and per-listing `lastUpdated`. The Worker uses a daily cached Torn item catalog for the weapon class (e.g. SMG); weapons without a verified class are not valued.

## Deployment prerequisites

Use a dedicated preview D1 database and R2 bucket, apply `migrations/0001_ranked_gear.sql`, and provision the Worker-only `TORN_AUCTION_KEY` with public auction and item-market access. Set an explicit starting Unix timestamp and use `wrangler.example.json` as a template, not as an already deployed configuration. Start with live scanning disabled. Before enabling it, verify Weaver's live response and confirm the Worker plan permits the combined number of subrequests. No production deployment or historical data import is implied by these sources.

The API routes are disabled by default (`PREVIEW_HTTP_ENABLED`). Before enabling them, configure access and rate limits for the preview. The extension and PDA Market panels point at the named preview Worker, save a single broad watch locally, and flag new results only while the panel is visible. Background alerts and existing Market Watch slot integration are not included. Do not treat a match as a guarantee that the listing is still available.

Tests: `node --test ranked-gear.test.mjs`.
