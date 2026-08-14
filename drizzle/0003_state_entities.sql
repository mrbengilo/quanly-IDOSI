PRAGMA foreign_keys = ON;
--> statement-breakpoint

-- Top-level arrays are externalized record-by-record. The manifest keeps empty
-- arrays distinguishable from missing scalar keys during transparent hydration.
CREATE TABLE IF NOT EXISTS state_collections (
  scope_key TEXT NOT NULL,
  collection_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_key, collection_key),
  FOREIGN KEY (scope_key) REFERENCES app_state(scope_key) ON DELETE CASCADE
) WITHOUT ROWID, STRICT;
--> statement-breakpoint

-- 1,500,000 bytes leaves headroom below D1's 2 MB maximum row/string size for
-- keys and metadata. Sparse signed ordering permits prepend-heavy collections
-- such as orders and notifications without rewriting historical rows.
CREATE TABLE IF NOT EXISTS state_entities (
  scope_key TEXT NOT NULL,
  collection_key TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  entity_order INTEGER NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  value_bytes INTEGER NOT NULL
    CHECK (value_bytes >= 0 AND value_bytes <= 1500000)
    CHECK (value_bytes = length(CAST(value_json AS BLOB))),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_key, collection_key, entity_key),
  FOREIGN KEY (scope_key, collection_key)
    REFERENCES state_collections(scope_key, collection_key) ON DELETE CASCADE
) WITHOUT ROWID, STRICT;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS idx_state_entities_collection_order
ON state_entities (scope_key, collection_key, entity_order, entity_key);
--> statement-breakpoint

-- Large idempotent responses use a small manifest in command_receipts and
-- UTF-8-safe chunks. Chunks need not be independently valid JSON.
CREATE TABLE IF NOT EXISTS command_receipt_chunks (
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  chunk_text TEXT NOT NULL,
  chunk_bytes INTEGER NOT NULL
    CHECK (chunk_bytes >= 0 AND chunk_bytes <= 1500000)
    CHECK (chunk_bytes = length(CAST(chunk_text AS BLOB))),
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_id, idempotency_key, chunk_index),
  FOREIGN KEY (actor_id, idempotency_key)
    REFERENCES command_receipts(actor_id, idempotency_key) ON DELETE CASCADE
) WITHOUT ROWID, STRICT;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_command_receipt_chunks_created
ON command_receipt_chunks (created_at);
--> statement-breakpoint

-- Catalog every existing top-level array, including empty arrays. app_state is
-- intentionally left untouched so this migration is safe before Worker rollout.
INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
SELECT
  app.scope_key,
  CAST(collection.key AS TEXT),
  app.updated_at,
  app.updated_at
FROM app_state AS app
JOIN json_each(app.value_json) AS collection ON 1 = 1
WHERE collection.type = 'array'
ON CONFLICT (scope_key, collection_key) DO UPDATE SET
  updated_at = excluded.updated_at;
--> statement-breakpoint

-- Preserve every item, including duplicate IDs and JSON scalar/null values.
-- Legacy rows start one million apart so prepend writes remain incremental.
WITH root_arrays AS (
  SELECT
    app.scope_key,
    app.updated_at,
    CAST(collection.key AS TEXT) AS collection_key,
    collection.value AS collection_json
  FROM app_state AS app
  JOIN json_each(app.value_json) AS collection ON 1 = 1
  WHERE collection.type = 'array'
),
expanded AS (
  SELECT
    collection.scope_key,
    collection.collection_key,
    collection.updated_at,
    CAST(entity.key AS INTEGER) AS array_index,
    entity.type AS entity_type,
    entity.value AS entity_value,
    entity.atom AS entity_atom
  FROM root_arrays AS collection
  JOIN json_each(collection.collection_json) AS entity ON 1 = 1
),
encoded AS (
  SELECT
    scope_key,
    collection_key,
    updated_at,
    array_index,
    CASE entity_type
      WHEN 'text' THEN json_quote(entity_atom)
      WHEN 'null' THEN 'null'
      WHEN 'true' THEN 'true'
      WHEN 'false' THEN 'false'
      ELSE json(entity_value)
    END AS value_json
  FROM expanded
)
INSERT INTO state_entities (
  scope_key, collection_key, entity_key, entity_order,
  value_json, value_bytes, created_at, updated_at
)
SELECT
  scope_key,
  collection_key,
  printf('legacy:%012d', array_index),
  (array_index + 1) * 1000000,
  value_json,
  length(CAST(value_json AS BLOB)),
  updated_at,
  updated_at
FROM encoded
WHERE 1 = 1
ON CONFLICT (scope_key, collection_key, entity_key) DO UPDATE SET
  entity_order = excluded.entity_order,
  value_json = excluded.value_json,
  value_bytes = excluded.value_bytes,
  updated_at = excluded.updated_at;
--> statement-breakpoint

PRAGMA foreign_key_check;
--> statement-breakpoint

PRAGMA optimize;
