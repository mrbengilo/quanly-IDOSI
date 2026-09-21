PRAGMA foreign_keys = ON;
--> statement-breakpoint

-- Keep the stable product identity introduced by 0014, but expose the current
-- menswear name in configuration as well as in historical projections.
WITH product_labels AS (
  SELECT
    entity_key,
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
    AND COALESCE(CAST(json_extract(value_json, '$.kind') AS TEXT), 'occupation') = 'product'
)
UPDATE state_entities
SET
  value_json = json_set(
    value_json,
    '$.label', 'Quần áo nam',
    '$.normalizedLabel', 'quần áo nam',
    '$.updatedAt', '2026-09-21T00:00:00+07:00',
    '$.updatedBy', 'SYSTEM'
  ),
  value_bytes = length(CAST(json_set(
    value_json,
    '$.label', 'Quần áo nam',
    '$.normalizedLabel', 'quần áo nam',
    '$.updatedAt', '2026-09-21T00:00:00+07:00',
    '$.updatedBy', 'SYSTEM'
  ) AS BLOB)),
  updated_at = '2026-09-21T00:00:00+07:00'
WHERE scope_key = 'global'
  AND collection_key = 'orderInformationOptions'
  AND entity_key IN (
    SELECT legacy.entity_key
    FROM product_labels AS legacy
    WHERE legacy.normalized_label = 'đồ nam'
      AND NOT EXISTS (
        SELECT 1
        FROM product_labels AS current
        WHERE current.normalized_label = 'quần áo nam'
          AND current.entity_key <> legacy.entity_key
      )
  );
--> statement-breakpoint

-- If an installation already created the new menswear option separately,
-- retain it and soft-disable the exact retired duplicate instead of renaming
-- two records to the same active label.
WITH product_labels AS (
  SELECT
    entity_key,
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
    AND COALESCE(CAST(json_extract(value_json, '$.kind') AS TEXT), 'occupation') = 'product'
), legacy_duplicates AS (
  SELECT legacy.entity_key
  FROM product_labels AS legacy
  WHERE legacy.normalized_label = 'đồ nam'
    AND EXISTS (
      SELECT 1 FROM product_labels AS current
      WHERE current.normalized_label = 'quần áo nam'
        AND current.entity_key <> legacy.entity_key
    )
)
UPDATE state_entities
SET
  value_json = json_set(
    value_json,
    '$.active', json('false'),
    '$.deletedAt', '2026-09-21T00:00:00+07:00',
    '$.deletedBy', 'SYSTEM',
    '$.deleteReason', 'Tên cũ đã được thay bằng Quần áo nam.',
    '$.updatedAt', '2026-09-21T00:00:00+07:00',
    '$.updatedBy', 'SYSTEM'
  ),
  value_bytes = length(CAST(json_set(
    value_json,
    '$.active', json('false'),
    '$.deletedAt', '2026-09-21T00:00:00+07:00',
    '$.deletedBy', 'SYSTEM',
    '$.deleteReason', 'Tên cũ đã được thay bằng Quần áo nam.',
    '$.updatedAt', '2026-09-21T00:00:00+07:00',
    '$.updatedBy', 'SYSTEM'
  ) AS BLOB)),
  updated_at = '2026-09-21T00:00:00+07:00'
WHERE scope_key = 'global'
  AND collection_key = 'orderInformationOptions'
  AND entity_key IN (SELECT entity_key FROM legacy_duplicates)
  AND COALESCE(json_extract(value_json, '$.active'), 1) <> 0;
--> statement-breakpoint

-- “Đồ nữ” is a retired category. Keep its row for historical references, but
-- prevent new orders from selecting it; reads canonicalize the old label to
-- “Áo nữ” without rewriting any saved order.
WITH retired_womenswear AS (
  SELECT entity_key
  FROM state_entities
  WHERE scope_key = 'global'
    AND collection_key = 'orderInformationOptions'
    AND COALESCE(CAST(json_extract(value_json, '$.kind') AS TEXT), 'occupation') = 'product'
    AND lower(replace(replace(replace(
      trim(COALESCE(
        NULLIF(CAST(json_extract(value_json, '$.normalizedLabel') AS TEXT), ''),
        CAST(json_extract(value_json, '$.label') AS TEXT),
        ''
      )),
      'Đ', 'đ'), 'Ồ', 'ồ'), 'Ữ', 'ữ')) = 'đồ nữ'
)
UPDATE state_entities
SET
  value_json = json_set(
    value_json,
    '$.active', json('false'),
    '$.deletedAt', '2026-09-21T00:00:00+07:00',
    '$.deletedBy', 'SYSTEM',
    '$.deleteReason', 'Danh mục cũ đã ngừng; sử dụng Áo nữ.',
    '$.updatedAt', '2026-09-21T00:00:00+07:00',
    '$.updatedBy', 'SYSTEM'
  ),
  value_bytes = length(CAST(json_set(
    value_json,
    '$.active', json('false'),
    '$.deletedAt', '2026-09-21T00:00:00+07:00',
    '$.deletedBy', 'SYSTEM',
    '$.deleteReason', 'Danh mục cũ đã ngừng; sử dụng Áo nữ.',
    '$.updatedAt', '2026-09-21T00:00:00+07:00',
    '$.updatedBy', 'SYSTEM'
  ) AS BLOB)),
  updated_at = '2026-09-21T00:00:00+07:00'
WHERE scope_key = 'global'
  AND collection_key = 'orderInformationOptions'
  AND entity_key IN (SELECT entity_key FROM retired_womenswear)
  AND COALESCE(json_extract(value_json, '$.active'), 1) <> 0;
--> statement-breakpoint

INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
SELECT
  'migration:0015:retire-legacy-product-names',
  json_object(
    'currentMenswear', 'Quần áo nam',
    'currentWomenswear', 'Áo nữ',
    'retiredWomenswear', 'Đồ nữ',
    'appliedAt', '2026-09-21T00:00:00+07:00'
  ),
  1,
  '2026-09-21T00:00:00+07:00'
FROM app_state
WHERE scope_key = 'global'
ON CONFLICT (meta_key) DO NOTHING;
--> statement-breakpoint

PRAGMA foreign_key_check;
--> statement-breakpoint

PRAGMA optimize;
