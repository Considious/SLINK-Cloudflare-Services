-- SLINK regular-feature permission sweep.
-- Market Watch tiers, administrative access, officer controls, paid themes,
-- and legacy scopes are intentionally excluded from automatic faction grants.
PRAGMA foreign_keys = ON;

INSERT INTO permission_scope_catalog (
    scope, category, title, description, default_hours, assignable, created_at, updated_at
) VALUES
    ('slink.combat.bounties', 'Combat', 'Bounty Tracking',
     'Scan, filter, and refine Torn bounties.', NULL, 1, unixepoch() * 1000, unixepoch() * 1000),
    ('slink.combat.player-stats', 'Combat', 'Player Stats',
     'View the SLINK player-stat dashboard.', NULL, 1, unixepoch() * 1000, unixepoch() * 1000),
    ('slink.combat.target-list', 'Combat', 'Target List',
     'Maintain target lists, polling, and stakeout alerts.', NULL, 1, unixepoch() * 1000, unixepoch() * 1000),
    ('slink.efficiency.merits', 'Efficiency', 'Merit Assistant',
     'View merit progress and recommendations.', NULL, 1, unixepoch() * 1000, unixepoch() * 1000),
    ('slink.efficiency.dollar-bazaars', 'Efficiency', '$1 Bazaars',
     'View Weaver $1 bazaar intelligence.', NULL, 1, unixepoch() * 1000, unixepoch() * 1000),
    ('slink.qol.racing', 'Quality of Life', 'Racing',
     'Use the racing build guide and race assistant.', NULL, 1, unixepoch() * 1000, unixepoch() * 1000),
    ('slink.qol.abroad-stocks', 'Quality of Life', 'Abroad Stocks',
     'Compare and track third-party abroad stock intelligence.', NULL, 1, unixepoch() * 1000, unixepoch() * 1000)
ON CONFLICT(scope) DO UPDATE SET
    category = excluded.category,
    title = excluded.title,
    description = excluded.description,
    default_hours = excluded.default_hours,
    assignable = excluded.assignable,
    updated_at = excluded.updated_at;

UPDATE permission_scope_catalog
SET title = 'Organized Crime Travel Safety (built in)',
    description = 'Built-in background safeguard; no permission is required.',
    assignable = 0
WHERE scope = 'slink.qol.travel-safety';

UPDATE permission_scope_catalog
SET description = 'Full SLINK administration for explicitly granted administrators.',
    assignable = 0
WHERE scope = 'admin.*';

WITH regular_feature_scopes(scope) AS (
    VALUES
        ('slink.level'),
        ('slink.war'),
        ('slink.mugging'),
        ('slink.adhd.alerts'),
        ('slink.combat.bounties'),
        ('slink.combat.player-stats'),
        ('slink.combat.target-list'),
        ('slink.efficiency.merits'),
        ('slink.efficiency.dollar-bazaars'),
        ('slink.qol.racing'),
        ('slink.qol.abroad-stocks'),
        ('slink.qol.company'),
        ('slink.qol.museum')
)
INSERT INTO faction_scope_grants (
    faction_id, scope, status, starts_at, expires_at, granted_by, note, created_at, updated_at
)
SELECT
    46978, scope, 'active', unixepoch() * 1000, NULL, 3853023,
    'Included regular SLINK feature access for current Slinky members',
    unixepoch() * 1000, unixepoch() * 1000
FROM regular_feature_scopes
WHERE 1
ON CONFLICT(faction_id, scope) DO UPDATE SET
    status = 'active',
    starts_at = excluded.starts_at,
    expires_at = NULL,
    granted_by = excluded.granted_by,
    note = excluded.note,
    updated_at = excluded.updated_at;
