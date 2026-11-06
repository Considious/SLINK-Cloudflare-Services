# SLINK Naughty List — testing only

Branch: `themes`. ID: `slink-naughty-list`. This package is **not registered in the production catalogue** and does not change extension/PDA behaviour or permissions.

The `SLINK-Website` themes branch includes an identical package under `site/themes/naughty-list/`. Its Theme Lab registers the draft locally; it does not request a key or call SLINK game services. The production homepage/theme collection remains unchanged.

## Package

- `theme.js`: centralized new tokens, aliases for SLINK’s existing token names, asset URLs and optional page copy. URLs resolve relative to the package, so it can move without edits to every component.
- `theme.css`: scoped skin for frames, panels, buttons/states, alerts, compact tooltips, tables with sticky header/name cells, badges and responsive/mobile treatment. Nothing applies without `data-theme="slink-naughty-list"` on an ancestor.
- `frame.js`: `NaughtyFrame(existingElement, {variant, padding, compact, interactive, className})` decorates existing content without replacing nodes, listeners or game logic. Call `.dispose()` to remove its owned decoration.
- `preview.js`: one local adapter for the lab’s existing controls, sample page hooks and optional flavor text. No per-game-module conditionals.
- `assets/frames/`: nine separate WebP slices and an atlas. Source caps are 201px square; displayed corner caps stay square at 26px desktop / 20px mobile (compact: 18/16px). Only edge strips stretch along their edge. The centre remains transparent (alpha <= 1/255 from the generated source).
- `prepare-assets.mjs`: mechanical slicing/optimization of the generated source PNGs. It needs the host's Sharp module path in `SLINK_SHARP_MODULE`, followed by the two source image paths. No external image API or key is needed to reuse the finished assets.
- `ASSET-PROMPTS.md`: asset provenance and complete prompts used with the built-in image tool.

Total raster package: 560,550 bytes including the optional atlas. No animated snow, live poller, external font or broad blur/filter effects. The webpage reuses the images across components.

## Preview

Deploy the **website `themes` branch to a separate Cloudflare preview**, with `site` as the same static asset directory used by the existing website. Open `/theme-lab/?theme=slink-naughty-list` on that preview. Do not change the production branch or deploy the theme branch over the production Worker to obtain a preview.

No production branch was changed. The live website's existing lab cannot load this draft until a testing deployment is available; a branch-only commit is not itself a live preview URL.

## Validation / review

`qa/naughty-list.browser.mjs` in the website branch covers 1440, 768, 390 and 320px, nine-piece caps on resizing, theme cleanup, component variants, keyboard focus, page-specific copy, sticky table cells, missing assets and absence of live API requests. Existing theme catalogue checks also pass. Primary/secondary text and error/success/warning labels use high-contrast light colours on black-ice surfaces; status is not conveyed by colour alone.

In the lab: inspect Alerts and Market; visit Combat → War, Targets, Mugging; Quality of Life → Racing and Chat; Access → Theme component samples. Resize the panel and review tooltip/table/badge/button states. Uncheck unfinished themes or choose an existing theme to confirm the skin cleans up.

Before release: user visual approval against the supplied concept, optional further artwork refinement, and an explicit decision to register/adapt this package into the live app theme renderers. No claim of live extension/PDA testing is made at this stage.
