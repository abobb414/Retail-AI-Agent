CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    vector_id TEXT UNIQUE,
    name TEXT NOT NULL,
    brand TEXT,
    price REAL,
    price_display TEXT,
    url TEXT,
    description TEXT,
    image TEXT,
    ideal_for TEXT,
    avoid_for TEXT
);

ALTER TABLE products ADD COLUMN vector_id TEXT;
ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN price_display TEXT;
ALTER TABLE products ADD COLUMN image TEXT;
ALTER TABLE products ADD COLUMN ideal_for TEXT;
ALTER TABLE products ADD COLUMN avoid_for TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS products_vector_id_idx ON products(vector_id);
