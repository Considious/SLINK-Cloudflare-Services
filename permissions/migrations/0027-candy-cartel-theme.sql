INSERT INTO permission_scope_catalog (scope,category,title,description,assignable,default_hours,created_at,updated_at)
VALUES ('slink.theme.candy-cartel','Themes','Candy Cartel','Use the Candy Cartel theme in SLINK and optional Torn page styling.',1,24,unixepoch()*1000,unixepoch()*1000)
ON CONFLICT(scope) DO UPDATE SET category=excluded.category,title=excluded.title,description=excluded.description,assignable=excluded.assignable,default_hours=excluded.default_hours,updated_at=excluded.updated_at;
