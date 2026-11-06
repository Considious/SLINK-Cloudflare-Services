# Naughty List — Christmas 2026

Theme ID: `slink-naughty-list`. Permission: `slink.theme.christmas2026` (existing `admin.*` override included). Room icon selection uses the same permission; existing selected room icons remain visible to room members.

Apply `permissions/migrations/0026-christmas-2026-theme.sql` once to the existing SLINK permissions D1 database. It adds only an assignable catalog entry: no new database, secret or binding. Existing GitHub-linked Worker deployments supply the updated Chat Central/Node code. Theme assets and catalog are served from this repository's main branch.

18 reviewed fixed artwork files under `themes/assets/christmas2026-*`; Chrome packages the same files for page-embedded use. PDA uses their HTTPS versions. UI source in the extension/PDA uses explicit render hooks, not background DOM polling. No storage schema, corruption recovery, save queues, API schedules or alert triggering logic were changed.

The icon picker uses fixed `naughty_*` IDs, never arbitrary user-supplied image URLs. Chat Central includes active Christmas/wildcard grants in short-lived signed claims; the Node authorizes new icon selections at save time. Personal room capacity remains separate. Explicit Chat Leaders are still required for faction management; this change does not give admin.* new faction-administration rights.

Original artwork generated for SLINK; see Theme Lab branch `themes/naughty-list/ALERT-PROP-PROMPTS.md` and `ASSET-PROMPTS.md` for prompts/provenance. Torn Rooms UI attribution and MIT license from Manuel [3747263] are retained.
