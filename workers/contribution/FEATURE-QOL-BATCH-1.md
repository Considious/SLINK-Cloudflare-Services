# QoL Batch 1 — feature preview

Branch: `feature/qol-batch-1`. Main is unchanged. Extension 0.19.64; PDA launcher 0.4.190.

## What's included

- Quality of Life → Page tools, with separate switches for quick items, custom links, item effects and values.
- Favorite usable items on the currently loaded Items or faction armory page using ☆. Inventory and armory lists are separate. Reorder using drag-and-drop or accessible up/down arrows; remove favorites without visiting the item again. Saved changes wait for a storage acknowledgement.
- A favorite's single click sends one Torn use action, without SLINK adding a confirmation. No background use, multi-item healing loop or automatic retry. Torn can still reject an action or impose its own restrictions.
- Armory energy/nerve point-refill shortcuts, available only while the native points armory controls are loaded. They cannot be added to the Items source.
- Medical shortcuts select the next item for leaving hospital or reaching full life with lower medical cooldown expenditure. Each click uses one item. Current life/hospital status is obtained through Torn's API, not hidden-page scraping. Extremely large plans stop at a bounded calculation limit instead of hanging PDA.
- Compatible healing and explicitly labeled incompatible self-hospital blood shortcuts. Set your **Torn character's** blood type manually; a displayed own-sidebar blood-type label can also populate it. The reviewed API schema did not expose a blood-type field; no item is consumed to discover it. Never infer your blood type from an arbitrary bag in your inventory.
- Blood selection checks compatibility first; in the faction armory it preserves O bags when a valid non-O alternative exists, then ranks by estimated market price, stock and a stable item ID. An AB+ character has no incompatible ordinary blood type: the helper explains this rather than selecting a compatible bag for self-hospitalization.
- Item information from Torn's item catalogue and personal perks, including faction and education bonuses. Can/candy/alcohol bonuses are category-specific and are not applied to drugs. Unrecognized effects remain descriptions instead of fabricated numbers. Incomplete perk data does not become an assumed zero bonus.
- Inventory/armory per-item and stack estimates, plus matched trade-row estimates. These are market estimates, not guaranteed proceeds, shop sell prices or live market-watch quotes.
- Custom named links with add/edit/remove, new-tab option and persistent ordering. Credentials and script URLs cannot be used as custom links.
- Public update metadata endpoint in the existing Contribution Worker, with six-hour shared caching and six-hour client caching. No player-version database, extra D1 database, individual version tracking or Torn API quota used for notices. A newer published main version is linked from Page tools/native notice; feature versions are not advertised as production updates.

## How to test

1. Disable the production SLINK build while testing the preview. Do not run two SLINK builds at once. Extension ZIP: load the extracted folder as an unpacked extension. PDA: use this branch's `.user.js` installer; it loads this branch's sources and has a separate last-known-working runtime cache.
2. Verify Access, open **Quality of Life → Page tools**, set your Torn blood type and press **Refresh item information** once. Cached information survives navigation; stale medical bonus information refreshes on an explicit medical-shortcut click, not an idle timer.
3. On Items, open a usable item category, add ☆ favorites, use one, and reorder/remove them in Page tools. Repeat on the faction medical armory. Confirm only one item is consumed per deliberate click, including after repeated quick clicks or a failed response.
4. Test the two healing modes against your current life/hospital time, and compatible blood selection against your character's type. **Self-hospitalization intentionally uses incompatible blood**; test only if you actually want that in-game effect.
5. Check armory point refills on the points tab. Refills must remain unavailable on inventory pages or when the native refill access controls are not loaded.
6. Navigate away/back, switch faction armory tabs, change page focus and reload. Favorites must remain saved, controls must not duplicate, and disabled features must not keep observing the page.
7. Check item-effect numbers with your actual faction bonuses and education. Check themed readability on PDA and extension. Test with TornTools quick items disabled to avoid confusing the two trays.

## Verification and remaining boundaries

Automated coverage includes calculation cases, all ordinary blood-type combinations, account isolation in the extension service, request coalescing, release caching and browser fixtures at mobile/desktop sizes. Browser fixtures simulate item-use responses; they do not spend real Torn items or establish that every current Torn markup variant works. Actual Android/iOS PDA and live Torn action testing remain necessary before merging to main.

Trade estimates currently require a recognized native item row and quantity. Unknown layouts are skipped. This preview does not claim a full trade total including cash/points, Bazaar accounting or net sale proceeds.

The update endpoint is code on the **Services feature branch**, not a deployed production Worker change. Testing that endpoint needs a separate preview/test deployment of that branch; otherwise the client fails quietly and its manual check explains that update metadata is unavailable. No database setup is required. Do not repoint the production Worker to this branch merely to test it.

The existing PDA native storage recovery, checkpoint and reset implementations were not changed. The relevant native recovery regression test passes with the packaged preview.

## Attribution and mechanics sources

Feature inspiration: Mephiles and the TornTools contributors, https://github.com/Mephiles/torntools_extension. These helpers and UI were independently written; no GPL TornTools implementation/data tables were copied.

Data/schema: https://www.torn.com/swagger/openapi.json (`user/perks`, `user/bars`, `user/profile`, `torn/items`). Medical and faction mechanics: https://wiki.torn.com/wiki/Hospital and https://wiki.torn.com/wiki/Faction. Gameplay remains user-initiated; follow https://www.torn.com/rules.php. This preview is not a claim of staff approval.
