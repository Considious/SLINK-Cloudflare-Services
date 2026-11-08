# Cracking dictionary
The existing `slinkcontributionworker` binds the private `slink-cracking-dictionary` bucket as `CRACKING_DICTIONARY`. No S3 credentials or custom GitHub secrets are required. Arson continues using its original binding.

The GitHub workflow prepares pages from the pinned Torn-game dictionary and publishes them to `cracking-dictionary-v1` using GitHub's built-in workflow token. The Worker loads each requested page from R2 first. On a miss it fetches that single page from GitHub, validates it, and caches it in R2. The source branch is write-once by convention; use a new version for a different corpus.

Reads contain only a length, a leading-character bucket (or `common`), and a page number. Clients retain their offline starter when the service is unavailable. The separate authenticated POST accepts batches of confirmed Torn-game answers from the enabled helper. The shared corpus stores answers only, not player IDs, API keys, patterns, or inferred variants. Set `CRACKING_CONTRIBUTIONS` to `off` in the Worker configuration to pause collection without disabling reads.
