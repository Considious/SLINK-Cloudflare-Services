# Candy Cartel — Theme Lab draft

Purple candy-mafia speakeasy theme based on the approved SLINK concept. Independent of Naughty List / Christmas.

- `theme.js`: SLINK colour-token contract, branding and scoped assets.
- `theme.css`: resizable sugar-glass frames, wrapper buttons, full-height wallpaper, non-interactive rope/chain edges.
- `preview.js`: Theme Lab adapter; real sample controls/text, reversible decoration only. No polling, observers, account data or live API requests.
- `alert-props.js`: preview examples for medical, drug, booster, energy/nerve refills, casino, addiction, city shopping, flights, racing, education, stocks, organized crime and Market Watch. Twelve independent icon assets; refills reuse the matching syringe with a lightning/flame badge.
- `assets/`: optimized WebP artwork with transparency preserved. Corners use nine-slice borders instead of stretching a whole image over a panel.
- `ASSET-PROMPTS.md`: full generation prompts and source provenance. `prepare-assets.mjs` performs mechanical size/format conversion only.
- `ALERT-ICON-PROMPTS.md`: nine additional pistachio/chocolate/gold alert-icon prompts. Alternating alert surfaces use purple → cherry red and purple → pistachio green; error alerts retain the red treatment.

Preview: `/theme-lab/?theme=slink-candy-cartel`. Only the website Theme Lab imports this draft; it is not registered in the production app catalogue and grants no app access. No extension or PDA build changes.

Header subtitle: **Sugar Logistics & Illicit Network of Kriminals**. The theme selector still calls the theme Candy Cartel.

To reproduce optimized assets, supply generated originals named as in `source-manifest.json`, set `SLINK_CANDY_SOURCE_DIR` to that directory and `SLINK_SHARP_MODULE` to your installed Sharp module, then run `node prepare-assets.mjs`. Source PNGs are kept outside the served site; the website ships about 1.04 MiB of WebP artwork. There are no animated assets or per-frame effects.

No new font, library, external asset host, animation loop or service is required. Preview-only casino and market examples are removed when switching themes. Production permission/icon integration is intentionally deferred until visual approval.
