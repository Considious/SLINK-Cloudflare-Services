PRAGMA foreign_keys = ON;

-- Officers control faction-wide War mode and may view retained War logs.
-- Med-out claims and the shared mode themselves remain transient inside each
-- per-war Durable Object, so this migration adds permission metadata only.
INSERT INTO permission_scope_catalog (
    scope, title, description, assignable, default_hours, created_at, updated_at
) VALUES (
    'slink.war.officer',
    'SLINK War Officer',
    'Control faction-wide War mode and view retained War logs.',
    1,
    24,
    unixepoch() * 1000,
    unixepoch() * 1000
)
ON CONFLICT(scope) DO UPDATE SET
    title = excluded.title,
    description = excluded.description,
    assignable = excluded.assignable,
    default_hours = excluded.default_hours,
    updated_at = excluded.updated_at;

-- Retained logs now follow the officer permission. Revoke legacy independent
-- log grants so ordinary War users cannot retain log access accidentally.
UPDATE user_scope_grants
SET status = 'revoked',
    note = 'Replaced by slink.war.officer',
    updated_at = unixepoch() * 1000
WHERE scope = 'slink.war.log' AND status = 'active';

UPDATE permission_scope_catalog
SET assignable = 0,
    description = 'Legacy scope replaced by slink.war.officer.',
    updated_at = unixepoch() * 1000
WHERE scope = 'slink.war.log';
