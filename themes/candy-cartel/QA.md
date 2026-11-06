# Candy Cartel draft checks

2026-11-06 — local Chrome browser checks using the actual static files and route-served local assets (not an on-device PDA test).

- 1440, 768, 390 and 320 px: no page overflow, usable controls, exact updated subtitle, full-height wallpaper, fixed nine-slice corners, 12 distinct loaded alert icons across 14 example alerts.
- Purple-to-pistachio and purple-to-cherry backgrounds differ as intended; error cards retain red. Energy/nerve examples have separate lightning/flame emblems.
- Props occupy a dedicated grid column; action buttons span the row below them, without overlap.
- Keyboard focus, panel-opacity control, section/module switching and minimize/expand passed.
- Candy → Naughty List → ordinary theme → Candy leaves no duplicated sample cards, icons, rails or branding.
- Production catalogue + local draft with the same ID produces one choice, not two.
- Browser requests limited to local site files and the approved theme catalogue/assets; no game/API/account calls, unexpected requests, missing assets or page errors.
- Existing Naughty List checks passed at all four widths. General Theme Lab regression passed at 1440/390 px. Existing static/security checks passed.

All 17 optimized images total 1,086,082 bytes. All new icon assets retain transparency. Mobile drug, booster and education screenshots were visually inspected after the browser checks. No new runtime dependency, observer, polling interval, animation loop or production app code was added. Further real-device and visual review is required before releasing the theme to the extension/PDA.
