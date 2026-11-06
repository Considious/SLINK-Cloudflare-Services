# Candy Cartel draft checks

2026-11-06 — local Chrome browser checks using the actual static files and route-served local assets (not an on-device PDA test).

- 1440, 768, 390 and 320 px: no page overflow, usable controls, exact updated subtitle, full-height wallpaper, fixed nine-slice corners, 12 distinct loaded alert icons across 14 example alerts.
- Gradient direction is checked explicitly: purple → green followed by red → purple; the sequence also includes green → purple and purple → red. Error cards use red → purple. Energy/nerve examples have separate lightning/flame emblems.
- Chocolate panel and control borders are loaded from their versioned assets. Snooze selects have the matching non-interactive wrapper frame; selecting 12 hours and using the keyboard to advance to 24 hours both passed. Wrappers are removed when switching themes.
- Props occupy a dedicated grid column; action buttons span the row below them, without overlap.
- Keyboard focus, panel-opacity control, section/module switching and minimize/expand passed.
- Candy → Naughty List → ordinary theme → Candy leaves no duplicated sample cards, icons, rails or branding.
- Production catalogue + local draft with the same ID produces one choice, not two.
- Browser requests limited to local site files and the approved theme catalogue/assets; no game/API/account calls, unexpected requests, missing assets or page errors.
- Existing Naughty List checks passed at all four widths. General Theme Lab regression passed at 1440/390 px. Existing static/security checks passed.

There are 19 stored images (1,155,842 bytes), including the two retained earlier borders; the 17 selected assets total 993,064 bytes. New frame assets retain transparency. Mobile drug and booster screenshots were visually inspected after the chocolate frame revision.

## App release integration

- Actual extension UI shell + Efficiency module checked at 390/1440 px; native PDA template + native alert markup and extension dashboard markup checked at the same widths. All 14 alert images loaded, frames/backgrounds rendered, and theme removal left no duplicate props or select wrappers.
- Candy → Christmas switching preserves the Christmas header instead of restoring stale branding over it.
- Real opt-in Torn theme controller checked against a local Torn-page fixture: the candy backdrop and chocolate panel borders render; the frame is not stretched across the full-page background.
- Exact shared CSS, denied/granted/admin entitlements, stale-catalogue fallback, startup inclusion, 17 packaged assets and extension version parity passed.
- Existing Christmas, Torn-theme safety and PDA native recovery/storage acknowledgement tests passed. Native storage/recovery implementation is unchanged.

These are local browser/source checks, not a physical-device PDA test. No new runtime observer, polling interval or animation loop was added.
