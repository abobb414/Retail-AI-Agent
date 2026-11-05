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

CREATE UNIQUE INDEX IF NOT EXISTS products_vector_id_idx ON products(vector_id);
