PRAGMA foreign_keys = ON;
--> statement-breakpoint

-- Add the first configurable product catalog without rewriting existing options.
-- Orders keep product snapshots, so future catalog edits cannot change history.
INSERT INTO state_collections (
  scope_key, collection_key, created_at, updated_at
)
SELECT
  app.scope_key,
  'orderInformationOptions',
  '2026-09-12T00:00:00+07:00',
  '2026-09-12T00:00:00+07:00'
FROM app_state AS app
WHERE app.scope_key = 'global'
ON CONFLICT (scope_key, collection_key) DO NOTHING;
--> statement-breakpoint

WITH product_seed (id, code, label, normalized_label, sort_order) AS (
  VALUES
    ('order-product-001', 'PRD-001', 'Đồ nam', 'đồ nam', 2000),
    ('order-product-002', 'PRD-002', 'Đầm', 'đầm', 2100),
    ('order-product-003', 'PRD-003', 'Áo nữ', 'áo nữ', 2200),
    ('order-product-004', 'PRD-004', 'Đồ nữ', 'đồ nữ', 2300),
    ('order-product-005', 'PRD-005', 'Đồ bộ', 'đồ bộ', 2400)
),
existing_options AS (
  SELECT
    CAST(json_extract(value_json, '$.id') AS TEXT) AS id,
    upper(trim(CAST(json_extract(value_json, '$.code') AS TEXT))) AS code,
    COALESCE(NULLIF(CAST(json_extract(value_json, '$.kind') AS TEXT), ''), 'occupation') AS kind,
    lower(replace(replace(replace(replace(replace(replace(
      trim(COALESCE(
        NULLIF(CAST(json_extract(value_json, '$.normalizedLabel') AS TEXT), ''),
        CAST(json_extract(value_json, '$.label') AS TEXT),
        ''
      )),
      'Đ', 'đ'), 'Ồ', 'ồ'), 'Ầ', 'ầ'), 'Á', 'á'), 'Ữ', 'ữ'), 'Ộ', 'ộ')) AS normalized_label
  FROM state_entities
  WHERE scope_key = 'global'
    AND collection_key = 'orderInformationOptions'
),
encoded_seed AS (
  SELECT
    seed.*,
    json_object(
      'id', seed.id,
      'kind', 'product',
      'code', seed.code,
      'label', seed.label,
      'normalizedLabel', seed.normalized_label,
      'active', json('true'),
      'sortOrder', seed.sort_order,
      'system', json('false'),
      'createdAt', '2026-09-12T00:00:00+07:00',
      'createdBy', 'SYSTEM',
      'updatedAt', '2026-09-12T00:00:00+07:00',
      'updatedBy', 'SYSTEM',
      'deletedAt', NULL,
      'deletedBy', NULL
    ) AS value_json
  FROM product_seed AS seed
)
INSERT INTO state_entities (
  scope_key, collection_key, entity_key, entity_order,
  value_json, value_bytes, created_at, updated_at
)
SELECT
  'global',
  'orderInformationOptions',
  'migration:0014:' || seed.id,
  seed.sort_order * 10000,
  seed.value_json,
  length(CAST(seed.value_json AS BLOB)),
  '2026-09-12T00:00:00+07:00',
  '2026-09-12T00:00:00+07:00'
FROM encoded_seed AS seed
WHERE EXISTS (
  SELECT 1 FROM app_state WHERE scope_key = 'global'
)
AND NOT EXISTS (
  SELECT 1
  FROM existing_options AS existing
  WHERE existing.id = seed.id
    OR existing.code = seed.code
    OR (existing.kind = 'product' AND existing.normalized_label = seed.normalized_label)
)
ON CONFLICT (scope_key, collection_key, entity_key) DO NOTHING;
--> statement-breakpoint

INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
SELECT
  'migration:0014:order-product-options',
  json_object(
    'collectionKey', 'orderInformationOptions',
    'productSeedCount', 5,
    'appliedAt', '2026-09-12T00:00:00+07:00'
  ),
  1,
  '2026-09-12T00:00:00+07:00'
FROM app_state
WHERE scope_key = 'global'
ON CONFLICT (meta_key) DO NOTHING;
--> statement-breakpoint

PRAGMA foreign_key_check;
--> statement-breakpoint

PRAGMA optimize;
