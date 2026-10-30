-- Public BSS-derived estimates only. No per-observer FF, private stats or keys.
CREATE TABLE IF NOT EXISTS fair_fight_backup (
 player_id INTEGER PRIMARY KEY,
 bs_estimate REAL NOT NULL CHECK(bs_estimate > 0),
 bss_public REAL NOT NULL CHECK(bss_public > 0),
 source TEXT NOT NULL CHECK(source = 'ffscouter-bss'),
 ff_last_updated INTEGER NOT NULL,
 slink_observed_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fair_fight_backup_budget (
 day INTEGER NOT NULL, actor TEXT NOT NULL, reserved INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(day,actor)
);
CREATE TABLE IF NOT EXISTS fair_fight_backup_meta (
 key TEXT PRIMARY KEY, value TEXT NOT NULL
);
