# Candy Cartel — approved theme source

Purple candy-mafia speakeasy theme based on the approved SLINK concept. Independent of Naughty List / Christmas.

- `theme.js`: SLINK colour-token contract, branding and scoped assets.
- `theme.css`: resizable sugar-glass frames, wrapper buttons, full-height wallpaper, non-interactive rope/chain edges.
- `preview.js`: Theme Lab adapter; real sample controls/text, reversible decoration only. No polling, observers, account data or live API requests.
- `alert-props.js`: preview examples for medical, drug, booster, energy/nerve refills, casino, addiction, city shopping, flights, racing, education, stocks, organized crime and Market Watch. Twelve independent icon assets; refills reuse the matching syringe with a lightning/flame badge.
- `assets/`: optimized WebP artwork with transparency preserved. Chocolate panel/control borders use nine-slice corners; the original sugar-glass/foil frames remain available for comparison. Candy/chain side rails are unchanged.
- `ASSET-PROMPTS.md`: full generation prompts and source provenance. `prepare-assets.mjs` performs mechanical size/format conversion only.
- `ALERT-ICON-PROMPTS.md`: nine additional pistachio/chocolate/gold alert-icon prompts. Alert gradients cycle purple → green, red → purple, green → purple and purple → red. Error alerts use red → purple.
- `CHOCOLATE-FRAME-PROMPTS.md`: quieter molded chocolate panel borders and smooth chocolate/gold control borders. Native selects sit inside a reversible non-interactive frame wrapper; they keep their original touch, popup and keyboard behaviour.

Preview: `/theme-lab/?theme=slink-candy-cartel`. `theme.js` remains the sample-data authoring definition for the Theme Lab. `build-release.mjs` packages its CSS and artwork for the app entry points; the production definition is registered separately as `slink-candy-cartel`, gated by `slink.theme.candy-cartel` or `admin.*`. The runtime uses the same CSS byte-for-byte, with an adapter for existing native component markup and compact layouts.

Header subtitle: **Sugar Logistics & Illicit Network of Kriminals**. The theme selector still calls the theme Candy Cartel.

To reproduce optimized assets, supply generated originals named as in `source-manifest.json`, set `SLINK_CANDY_SOURCE_DIR` to that directory and `SLINK_SHARP_MODULE` to your installed Sharp module, then run `node prepare-assets.mjs`. Source PNGs are kept outside the served site; selected WebP artwork totals about 970 KiB. The two retained earlier frames are not requested by this revision. There are no animated assets or per-frame effects.

No new font, library, external asset host, animation loop or service is required. Native controls, event handlers and storage remain owned by their existing modules. The runtime decorates existing render hooks; it does not scrape Torn or observe the page. Torn-page styling remains behind the existing opt-in setting, using the backdrop, palette and chocolate panel frame without rebuilding gameplay controls.
