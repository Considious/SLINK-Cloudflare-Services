PRAGMA foreign_keys = ON;

-- Quality of Life modules use the shared SLINK permission authority. This
-- migration registers assignable scopes only; it grants access to no user or
-- faction. Existing user_scope_grants, faction_scope_grants, wildcard scopes,
-- and admin.* resolution continue to determine effective access.
INSERT INTO permission_scope_catalog (
    scope, category, title, description, assignable, default_hours,
    created_at, updated_at
) VALUES
    (
        'slink.qol.travel-safety',
        'Quality of Life',
        'Organized Crime Travel Safety',
        'Warn before a round trip is expected to return after an organized crime becomes ready.',
        1, 24, unixepoch() * 1000, unixepoch() * 1000
    ),
    (
        'slink.qol.company',
        'Quality of Life',
        'Company Assistant',
        'Use employee and director company assistance, train recommendations, and company alerts.',
        1, 24, unixepoch() * 1000, unixepoch() * 1000
    ),
    (
        'slink.qol.museum',
        'Quality of Life',
        'Museum Manager',
        'Track museum sets and connect missing items to Abroad Stocks and Market Watch.',
        1, 24, unixepoch() * 1000, unixepoch() * 1000
    ),
    (
        'slink.qol.finance',
        'Quality of Life',
        'Money and Property Manager',
        'Use investment, property, loan, stock benefit, and affordability alerts.',
        1, 24, unixepoch() * 1000, unixepoch() * 1000
    ),
    (
        'slink.qol.events',
        'Quality of Life',
        'Events',
        'Use the SLINK event calendar, event reminders, and future event guides.',
        1, 24, unixepoch() * 1000, unixepoch() * 1000
    )
ON CONFLICT(scope) DO UPDATE SET
    category = excluded.category,
    title = excluded.title,
    description = excluded.description,
    assignable = excluded.assignable,
    default_hours = excluded.default_hours,
    updated_at = excluded.updated_at;
