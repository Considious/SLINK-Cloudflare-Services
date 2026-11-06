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

Total raster package: 837,908 bytes including the optional atlas. The visible coal/graffiti vignette and crowned-skull blacklist note are allocated their own layout space, not hidden under cards or painted over text. `prepare-atmosphere.mjs` optimizes those new assets; their prompts are recorded in ASSET-PROMPTS.md.

No animated snow, live poller, external font or broad blur/filter effects. The webpage reuses the images across components.

## Preview

Open https://sharedliveintelligencenetwork.app/theme-lab/?theme=slink-naughty-list after the website's normal main-branch build. The draft is registered locally in the lab only. It is not added to the production theme catalogue or to the extension/PDA branches.

Website main is permitted for the lab. Extension main, PDA main and the shared production theme catalogue are unchanged. The reusable theme package remains on the Services repository's themes branch for review.

## Validation / review

`qa/naughty-list.browser.mjs` in the website branch covers 1440, 768, 390 and 320px, nine-piece caps on resizing, theme cleanup, component variants, keyboard focus, page-specific copy, sticky table cells, missing assets and absence of live API requests. Existing theme catalogue checks also pass. Primary/secondary text and error/success/warning labels use high-contrast light colours on black-ice surfaces; status is not conveyed by colour alone.

In the lab: inspect Alerts and Market; visit Combat → War, Targets, Mugging; Quality of Life → Racing and Chat; Access → Theme component samples. Resize the panel and review tooltip/table/badge/button states. Uncheck unfinished themes or choose an existing theme to confirm the skin cleans up.

Before release: user visual approval against the supplied concept, optional further artwork refinement, and an explicit decision to register/adapt this package into the live app theme renderers. No claim of live extension/PDA testing is made at this stage.
