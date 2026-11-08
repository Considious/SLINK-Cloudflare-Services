# Cracking dictionary preview

The contribution Worker serves only fixed, versioned dictionary paths. Create a separate private R2 bucket (suggested: `slink-cracking-dictionary`) and bind it to the contribution Worker as `CRACKING_DICTIONARY`. Keep it separate from user backups, and configure the binding in the worker deployment config or the dashboard for a dashboard-managed deploy. No D1 migration is needed.

Review the pinned legacy corpus before seeding. The GitHub workflow **Seed Cracking dictionary v1** generates and uploads the objects once the workflow is present on the repository’s default branch. Give it a token scoped to this bucket only, with GitHub secrets `CRACKING_R2_ACCESS_KEY_ID` and `CRACKING_R2_SECRET_ACCESS_KEY`, and repository variables `CRACKING_R2_ENDPOINT` and `CRACKING_R2_BUCKET`. The generator can also produce upload files from a reviewed local source. Do not overwrite v1 after publishing; use a new version for a replacement dataset. If a first upload stops partway, review the bucket state before retrying.

Reads contain only a length, a leading-character bucket (or `common` if the first slot is unknown), and a page number. The player, API key, complete pattern, and generated suggestions are never sent. The worker accepts no contributions through this route. Clients retain the offline starter dictionary when the service or seed is unavailable.
