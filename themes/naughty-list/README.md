# SLINK Naughty List — testing only

Theme package branch: `themes`. ID: `slink-naughty-list`. This package is **not registered in the production catalogue** and does not change extension/PDA behaviour or permissions.

The `SLINK-Website` Theme Lab includes an identical package under `site/themes/naughty-list/`. Its Theme Lab registers the draft locally; it does not request a key or call SLINK game services. The production app theme collection remains unchanged; the website lab is allowed on website main.

## Package

- `theme.js`: centralized new tokens, aliases for SLINK’s existing token names, asset URLs and optional page copy. URLs resolve relative to the package, so it can move without edits to every component.
- `theme.css`: scoped skin for frames, panels, buttons/states, alerts, compact tooltips, tables with sticky header/name cells, badges and responsive/mobile treatment. Nothing applies without `data-theme="slink-naughty-list"` on an ancestor.
- `frame.js`: `NaughtyFrame(existingElement, {variant, padding, compact, interactive, className})` decorates existing content without replacing nodes, listeners or game logic. Call `.dispose()` to remove its owned decoration.
- `preview.js`: one local adapter for the lab’s existing controls, sample page hooks and optional flavor text. No per-game-module conditionals.
- `assets/frames/`: nine separate WebP slices and an atlas. Source caps are 201px square; displayed corner caps stay square at 26px desktop / 20px mobile (compact: 18/16px). Only edge strips stretch along their edge. The centre remains transparent (alpha <= 1/255 from the generated source).
- `prepare-assets.mjs`: mechanical slicing/optimization of the generated source PNGs. It needs the host's Sharp module path in `SLINK_SHARP_MODULE`, followed by the two source image paths. No external image API or key is needed to reuse the finished assets.
- `ASSET-PROMPTS.md`: asset provenance and complete prompts used with the built-in image tool.

Revision 3 adds a 593,248-byte portrait wall. The previous square backdrop and coal vignette remain as unused source alternatives, not loaded by the preview. The blacklist note stays inside its alert. `prepare-wall.mjs` and `prepare-atmosphere.mjs` format-optimize the generated assets; prompts are recorded in ASSET-PROMPTS.md.

No animated snow, live poller, external font or broad blur/filter effects. The webpage reuses the images across components.

## Preview

Open https://sharedliveintelligencenetwork.app/theme-lab/?theme=slink-naughty-list after the website's normal main-branch build. The draft is registered locally in the lab only. It is not added to the production theme catalogue or to the extension/PDA branches.

Website main is permitted for the lab. Extension main, PDA main and the shared production theme catalogue are unchanged. The reusable theme package remains on the Services repository's themes branch for review.

## Validation / review

`qa/naughty-list.browser.mjs` in the website branch covers 1440, 768, 390 and 320px, nine-piece caps on resizing, theme cleanup, component variants, keyboard focus, page-specific copy, sticky table cells, missing assets and absence of live API requests. Existing theme catalogue checks also pass. Primary/secondary text and error/success/warning labels use high-contrast light colours on black-ice surfaces; status is not conveyed by colour alone.

In the lab: inspect Alerts and Market; visit Combat → War, Targets, Mugging; Quality of Life → Racing and Chat; Access → Theme component samples. Resize the panel and review tooltip/table/badge/button states. Uncheck unfinished themes or choose an existing theme to confirm the skin cleans up.

Before release: user visual approval against the supplied concept, optional further artwork refinement, and an explicit decision to register/adapt this package into the live app theme renderers. No claim of live extension/PDA testing is made at this stage.
# Background revision 3

The coal slogan is painted directly onto a portrait hideout wall, not inserted as a content panel. Removed the added timer/Stack sample block. The wallpaper scales proportionally to the dashboard width and repeats vertically for long pages: it never stretches lettering or stops at the end of a square image. Bright crimson/emerald light, gold skulls/chains and a red syringe restore the original reference's deliberately excessive character. Alert text remains on dark surfaces; all decoration is non-interactive. No extra content height is reserved for background artwork.

# Finishing revision 4

Theme-local header: **SLINK** / **Santa’s Ledger of Illicit Naughty Knowledge**, with a Santa hat on the SL badge. Switching themes restores the normal header and icons. Transparent candy cane/gold-chain rails sit above the outer panel edges and ignore pointer input. Alert borders alternate brighter red and green, while existing status labels retain their meaning. Metric gradients are retained, with reversed red/green directions on adjacent tiles. Original SVG button icons include all four bottom navigation buttons. No changes to app logic or the production catalogue.

# Foreground trim scale

Candy-cane/chain artwork is now magnified uniformly inside a narrow, clipped side rail (160px background width on desktop, 120px on mobile). Both dimensions scale together; transparent gutters are cropped by the rail instead of shrinking the ornament into noise. Fewer, larger repeats reveal the chain links and stripes. A dark backing separates the trim from the busy wall without adding width to the page or blocking controls.

