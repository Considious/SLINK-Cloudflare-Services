# SLINK main promotion — 30 October 2026

Extension 0.19.15 and PDA 0.4.127 carry the testing implementation through Candidate40 into main. The extension's TESTER-CHANGELOG.md contains the combined user checklist.

## Included
Saved-data/draft protection, settings autosave/retry, page ownership and startup/cache improvements, shared stats/catalog freshness, dashboard/QOL parity repairs, Racing highlighting, current Mugging recovery, optional chat tools/Fair Fight bubbles/Torn-page themes, passive public Fair Fight fallback and clearer error messages.

## Release preparation
PDA keeps its original stable userscript name/namespace, stable runtime cache keys and existing user-data keys. Update/download/startup source links follow main, not testing or a pinned historical commit. Loader remains a small direct-source launcher; runtime/add-ons load externally. Extension versions agree across manifest/package/runtime. Worker source versions no longer carry the testing suffix.

All prior main files are retained unless replaced by their corresponding SLINK testing implementation. Unrelated Torn-Scripts root scripts, backups, workflows and data are not deleted or replaced by testing-branch root artifacts. Main's changelog/hotfix documentation is retained. Main Mugging helper/recovery is preserved and covered by the actual-client round-trip tests.

The main release contains the complete current PDA test inventory and helpers under SLINK-PDA, rather than relying on root-level copies from the testing branch. Release-channel fixtures check stable URLs/cache isolation. Production policy documents, required acceptance fingerprints, saved API keys and user-settings keys are unchanged.

## Validation and rollout boundaries
116/116 client validation commands and 96/96 worker/pipeline cases passed locally, zero skipped backend cases. This includes the public-backup/snapshot tests and actual-client Mugging round trips. Physical PDA, authenticated live Torn and live deployment acceptance remain separate; those have not been certified by local checks.

Cloudflare source is published through GitHub; no direct dashboard deployment, secret changes or migration execution is part of this promotion. FF_BACKUP_ENABLED and snapshots remain false. Migration0022 and deliberate configuration/deployment are still needed before enabling the shared remote backup; disabled/missing remote backup does not erase local cache.

The extension needs its normal Chrome Web Store release. PDA stable installer/update URL is unchanged. No automatic cloud settings restore, new paid resources, force-push or removal of the testing branch.

Pre-release main heads are retained under backup/pre-audit-promotion-2026-10-30 in all three repositories.
