CREATE TABLE IF NOT EXISTS ranked_sales (
 auction_id INTEGER PRIMARY KEY, item_uid TEXT, item_id INTEGER NOT NULL, item_name TEXT NOT NULL COLLATE NOCASE,
 category TEXT NOT NULL, weapon_class TEXT, rarity TEXT NOT NULL, quality REAL, damage REAL, accuracy REAL, armor REAL,
 bonus_1 TEXT COLLATE NOCASE, bonus_1_value REAL, bonus_2 TEXT COLLATE NOCASE, bonus_2_value REAL,
 sale_price INTEGER NOT NULL CHECK(sale_price > 0), ended_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ranked_sales_date ON ranked_sales(ended_at DESC, auction_id DESC);
CREATE INDEX IF NOT EXISTS ranked_sales_item_date ON ranked_sales(item_name, ended_at DESC);
CREATE INDEX IF NOT EXISTS ranked_sales_rarity_date ON ranked_sales(rarity, ended_at DESC);
CREATE TABLE IF NOT EXISTS ranked_ingest (
 id INTEGER PRIMARY KEY CHECK(id=1), completed_through INTEGER NOT NULL, window_end INTEGER, next_url TEXT
);
