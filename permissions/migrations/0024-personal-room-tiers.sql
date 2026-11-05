INSERT INTO permission_scope_catalog (
    scope, category, title, description, assignable, default_hours, created_at, updated_at
) VALUES
    ('slink.chat.personal.1', 'SLINK Rooms', 'Personal Rooms — 1', 'Personal room ownership tier: up to 1 room. Does not grant faction Chat Leader access.', 1, 720, unixepoch()*1000, unixepoch()*1000),
    ('slink.chat.personal.2', 'SLINK Rooms', 'Personal Rooms — 2', 'Personal room ownership tier: up to 2 rooms. Does not grant faction Chat Leader access.', 1, 720, unixepoch()*1000, unixepoch()*1000),
    ('slink.chat.personal.3', 'SLINK Rooms', 'Personal Rooms — 3', 'Personal room ownership tier: up to 3 rooms. Does not grant faction Chat Leader access.', 1, 720, unixepoch()*1000, unixepoch()*1000),
    ('slink.chat.personal.4', 'SLINK Rooms', 'Personal Rooms — 4', 'Personal room ownership tier: up to 4 rooms. Does not grant faction Chat Leader access.', 1, 720, unixepoch()*1000, unixepoch()*1000),
    ('slink.chat.personal.5', 'SLINK Rooms', 'Personal Rooms — 5', 'Personal room ownership tier: up to 5 rooms. Does not grant faction Chat Leader access.', 1, 720, unixepoch()*1000, unixepoch()*1000)
ON CONFLICT(scope) DO UPDATE SET
    category=excluded.category,
    title=excluded.title,
    description=excluded.description,
    assignable=excluded.assignable,
    default_hours=excluded.default_hours,
    updated_at=excluded.updated_at;

