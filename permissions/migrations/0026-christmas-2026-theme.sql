INSERT INTO permission_scope_catalog (scope,category,title,description,assignable,default_hours,created_at,updated_at)
VALUES ('slink.theme.christmas2026','Themes','Naughty List Christmas 2026','Use the Naughty List Christmas theme and choose its exclusive room icons.',1,24,unixepoch()*1000,unixepoch()*1000)
ON CONFLICT(scope) DO UPDATE SET category=excluded.category,title=excluded.title,description=excluded.description,assignable=excluded.assignable,default_hours=excluded.default_hours,updated_at=excluded.updated_at;
