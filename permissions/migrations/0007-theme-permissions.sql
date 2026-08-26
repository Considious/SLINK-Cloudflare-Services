PRAGMA foreign_keys = ON;

-- Keep product access and cosmetic entitlements in the existing
-- slink-permissions database. The category is presentation metadata for the
-- administrator dashboard; it does not grant access by itself.
ALTER TABLE permission_scope_catalog
ADD COLUMN category TEXT NOT NULL DEFAULT 'Products';

UPDATE permission_scope_catalog
SET category = CASE
    WHEN scope = 'slink.war.officer' THEN 'War permissions'
    WHEN scope LIKE 'slink.theme.%' THEN 'Themes'
    ELSE 'Products'
END,
updated_at = unixepoch() * 1000;

INSERT INTO permission_scope_catalog (
    scope, category, title, description, assignable, default_hours,
    created_at, updated_at
) VALUES
    (
        'slink.theme.pursuit',
        'Themes',
        'Slinky Pursuit',
        'Use the red, blue, and chrome Slinky Pursuit interface theme.',
        1,
        24,
        unixepoch() * 1000,
        unixepoch() * 1000
    ),
    (
        'slink.theme.underglow',
        'Themes',
        'Slinky Underglow',
        'Use the glossy black, purple, and green underglow interface theme.',
        1,
        24,
        unixepoch() * 1000,
        unixepoch() * 1000
    ),
    (
        'slink.theme.black-chrome',
        'Themes',
        'Slinky Black Chrome',
        'Use the black, gunmetal, and polished-silver interface theme.',
        1,
        24,
        unixepoch() * 1000,
        unixepoch() * 1000
    )
ON CONFLICT(scope) DO UPDATE SET
    category = excluded.category,
    title = excluded.title,
    description = excluded.description,
    assignable = excluded.assignable,
    default_hours = excluded.default_hours,
    updated_at = excluded.updated_at;
