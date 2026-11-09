# Officer Work ranked war archive

Deploy the SLINK website and Contribution Worker changes together. The archive
uses the existing minute scheduler, D1 permissions database and private
`USER_BACKUPS` R2 binding. No separate worker, bucket, or browser session is
needed for background collection.

Enable only after an authorized SLINK War Officer opts in to saving their Torn
credential encrypted in Officer Work and authorizes its use for the archive.
Set Worker configuration:

- `RANKED_ARCHIVE_FACTION_ID`: SLINKY's numeric Torn faction ID.
- `RANKED_ARCHIVE_CREDENTIAL_ID`: the saved Officer Work credential ID, **not** the Torn API key.
- `RANKED_ARCHIVE_ENABLED=true`: start scheduled backfill.

The existing key owner, current faction membership, officer scope, and Torn
Faction API Access checks run before collection. Revoking the credential or
switching the flag off stops further collection without deleting existing records.
Viewer sign-in uses normal Officer Work access and does not require storing a key.

Backfill walks the faction's Ranked War history, processes at most two war
reports per tick, and stores the history entry and available official report
payload under a faction-and-war-scoped R2 key. D1 holds a searchable index
and the checkpoint. Transient failures pause collection without losing saved
records. After reaching the end of history, the Worker checks for new or updated
completed wars approximately twice daily. Active wars and unavailable historical
reports are not counted as complete. The 30-day summary uses archived completion
dates and flags incomplete or stale coverage.
