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

There are 19 stored images (1,155,842 bytes), including the two retained earlier borders; the 17 selected assets total 993,064 bytes. New frame assets retain transparency. Mobile drug and booster screenshots were visually inspected after the chocolate frame revision. No new runtime dependency, observer, polling interval, animation loop or production app code was added. Further real-device and visual review is required before releasing the theme to the extension/PDA.
