#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const databaseName = process.env.D1_DATABASE_NAME;

if (!databaseName) {
  console.error("Missing D1_DATABASE_NAME. Example:");
  console.error("  D1_DATABASE_NAME=retail-ai-db node scripts/migrate-products-schema.mjs");
  process.exit(1);
}

const requiredColumns = [
  ["vector_id", "TEXT"],
  ["brand", "TEXT"],
  ["price_display", "TEXT"],
  ["image", "TEXT"],
  ["ideal_for", "TEXT"],
  ["avoid_for", "TEXT"],
  ["department", "TEXT"],
  ["product_type", "TEXT"],
  ["subcategory", "TEXT"],
  ["gender", "TEXT"],
  ["size_options", "TEXT"],
  ["attributes", "TEXT"],
];

runWranglerSql(`CREATE TABLE IF NOT EXISTS products (
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
  avoid_for TEXT,
  department TEXT,
  product_type TEXT,
  subcategory TEXT,
  gender TEXT,
  size_options TEXT,
  attributes TEXT
);`);

const tableInfo = runWranglerSql("PRAGMA table_info(products);");
const existingColumns = new Set(
  [...tableInfo.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((match) => match[1]),
);

for (const [columnName, columnType] of requiredColumns) {
  if (existingColumns.has(columnName)) {
    console.log(`Column already exists: ${columnName}`);
    continue;
  }

  console.log(`Adding column: ${columnName}`);
  runWranglerSql(`ALTER TABLE products ADD COLUMN ${columnName} ${columnType};`);
}

runWranglerSql("CREATE UNIQUE INDEX IF NOT EXISTS products_vector_id_idx ON products(vector_id);");
runWranglerSql("CREATE INDEX IF NOT EXISTS products_department_type_idx ON products(department, product_type);");
runWranglerSql("CREATE INDEX IF NOT EXISTS products_brand_idx ON products(brand);");

console.log("Products schema migration complete.");

function runWranglerSql(sql) {
  return execFileSync(
    "npx",
    ["wrangler", "d1", "execute", databaseName, "--remote", "--command", sql],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
}
