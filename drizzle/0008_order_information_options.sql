PRAGMA foreign_keys = ON;
--> statement-breakpoint

-- orderInformationOptions is a shared top-level array, so its production source
-- of truth is the generic row-per-entity state storage introduced in 0003.
-- Only initialized databases have a global app_state row. Fresh databases are
-- intentionally left for the atomic bootstrap flow to initialize.
INSERT INTO state_collections (
  scope_key, collection_key, created_at, updated_at
)
SELECT
  app.scope_key,
  'orderInformationOptions',
  '2026-08-25T00:00:00+07:00',
  '2026-08-25T00:00:00+07:00'
FROM app_state AS app
WHERE app.scope_key = 'global'
ON CONFLICT (scope_key, collection_key) DO NOTHING;
--> statement-breakpoint

-- Preserve a legacy compact array if it exists but has not yet been externalized.
-- Once any external rows exist, they remain authoritative and the compact copy is
-- left untouched for a later normal state write to remove.
WITH legacy_options AS (
  SELECT
    app.scope_key,
    app.updated_at,
    CAST(option.key AS INTEGER) AS array_index,
    option.type AS option_type,
    option.value AS option_value,
    option.atom AS option_atom
  FROM app_state AS app
  JOIN json_each(json_extract(app.value_json, '$.orderInformationOptions')) AS option ON 1 = 1
  WHERE app.scope_key = 'global'
    AND json_type(app.value_json, '$.orderInformationOptions') = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM state_entities AS external
      WHERE external.scope_key = app.scope_key
        AND external.collection_key = 'orderInformationOptions'
    )
),
encoded_legacy_options AS (
  SELECT
    scope_key,
    updated_at,
    array_index,
    CASE option_type
      WHEN 'text' THEN json_quote(option_atom)
      WHEN 'null' THEN 'null'
      WHEN 'true' THEN 'true'
      WHEN 'false' THEN 'false'
      ELSE json(option_value)
    END AS value_json
  FROM legacy_options
)
INSERT INTO state_entities (
  scope_key, collection_key, entity_key, entity_order,
  value_json, value_bytes, created_at, updated_at
)
SELECT
  scope_key,
  'orderInformationOptions',
  printf('migration:0008:legacy:%012d', array_index),
  (array_index + 1) * 1000000,
  value_json,
  length(CAST(value_json AS BLOB)),
  updated_at,
  updated_at
FROM encoded_legacy_options
WHERE 1 = 1
ON CONFLICT (scope_key, collection_key, entity_key) DO NOTHING;
--> statement-breakpoint

-- Seed canonical occupations and the two protected payment methods only when no
-- existing record owns their stable identity. SQLite lower()/NOCASE only fold
-- ASCII, so the recursive case map deterministically folds precomposed Vietnamese
-- uppercase characters before comparing legacy labels of the same kind. Existing rows
-- are never rewritten or deleted.
WITH RECURSIVE order_information_seed (
  id, kind, code, label, normalized_label, sort_order, system_value
) AS (
  VALUES
    ('order-occupation-001', 'occupation', 'OCC-001', 'Nhân viên VP', 'nhân viên vp', 100, 'false'),
    ('order-occupation-002', 'occupation', 'OCC-002', 'Kỹ sư', 'kỹ sư', 200, 'false'),
    ('order-occupation-003', 'occupation', 'OCC-003', 'Bác sĩ', 'bác sĩ', 300, 'false'),
    ('order-occupation-004', 'occupation', 'OCC-004', 'Giáo viên', 'giáo viên', 400, 'false'),
    ('order-occupation-005', 'occupation', 'OCC-005', 'Học sinh/Sinh viên', 'học sinh/sinh viên', 500, 'false'),
    ('order-occupation-006', 'occupation', 'OCC-006', 'Lao động', 'lao động', 600, 'false'),
    ('order-occupation-007', 'occupation', 'OCC-007', 'Nội trợ', 'nội trợ', 700, 'false'),
    ('order-occupation-008', 'occupation', 'OCC-008', 'Buôn bán/kinh doanh', 'buôn bán/kinh doanh', 800, 'false'),
    ('order-occupation-009', 'occupation', 'OCC-009', 'Tài xế', 'tài xế', 900, 'false'),
    ('order-occupation-010', 'occupation', 'OCC-010', 'Giám đốc', 'giám đốc', 1000, 'false'),
    ('order-occupation-011', 'occupation', 'OCC-011', 'Ca sỉ', 'ca sỉ', 1100, 'false'),
    ('order-occupation-012', 'occupation', 'OCC-012', 'Lao công', 'lao công', 1200, 'false'),
    ('order-occupation-013', 'occupation', 'OCC-013', 'Bảo vệ', 'bảo vệ', 1300, 'false'),
    ('order-occupation-014', 'occupation', 'OCC-014', 'Công nhân', 'công nhân', 1400, 'false'),
    ('order-occupation-015', 'occupation', 'OCC-015', 'Khác', 'khác', 1500, 'false'),
    ('order-payment-001', 'payment_method', 'PAY-001', 'Tiền mặt', 'tiền mặt', 1600, 'true'),
    ('order-payment-002', 'payment_method', 'PAY-002', 'Chuyển khoản', 'chuyển khoản', 1700, 'true')
),
vietnamese_case_map (fold_step, uppercase_character, lowercase_character) AS (
  VALUES
    (1, 'Á', 'á'), (2, 'À', 'à'), (3, 'Ả', 'ả'), (4, 'Ã', 'ã'), (5, 'Ạ', 'ạ'),
    (6, 'Ă', 'ă'), (7, 'Ắ', 'ắ'), (8, 'Ằ', 'ằ'), (9, 'Ẳ', 'ẳ'), (10, 'Ẵ', 'ẵ'), (11, 'Ặ', 'ặ'),
    (12, 'Â', 'â'), (13, 'Ấ', 'ấ'), (14, 'Ầ', 'ầ'), (15, 'Ẩ', 'ẩ'), (16, 'Ẫ', 'ẫ'), (17, 'Ậ', 'ậ'),
    (18, 'Đ', 'đ'),
    (19, 'É', 'é'), (20, 'È', 'è'), (21, 'Ẻ', 'ẻ'), (22, 'Ẽ', 'ẽ'), (23, 'Ẹ', 'ẹ'),
    (24, 'Ê', 'ê'), (25, 'Ế', 'ế'), (26, 'Ề', 'ề'), (27, 'Ể', 'ể'), (28, 'Ễ', 'ễ'), (29, 'Ệ', 'ệ'),
    (30, 'Í', 'í'), (31, 'Ì', 'ì'), (32, 'Ỉ', 'ỉ'), (33, 'Ĩ', 'ĩ'), (34, 'Ị', 'ị'),
    (35, 'Ó', 'ó'), (36, 'Ò', 'ò'), (37, 'Ỏ', 'ỏ'), (38, 'Õ', 'õ'), (39, 'Ọ', 'ọ'),
    (40, 'Ô', 'ô'), (41, 'Ố', 'ố'), (42, 'Ồ', 'ồ'), (43, 'Ổ', 'ổ'), (44, 'Ỗ', 'ỗ'), (45, 'Ộ', 'ộ'),
    (46, 'Ơ', 'ơ'), (47, 'Ớ', 'ớ'), (48, 'Ờ', 'ờ'), (49, 'Ở', 'ở'), (50, 'Ỡ', 'ỡ'), (51, 'Ợ', 'ợ'),
    (52, 'Ú', 'ú'), (53, 'Ù', 'ù'), (54, 'Ủ', 'ủ'), (55, 'Ũ', 'ũ'), (56, 'Ụ', 'ụ'),
    (57, 'Ư', 'ư'), (58, 'Ứ', 'ứ'), (59, 'Ừ', 'ừ'), (60, 'Ử', 'ử'), (61, 'Ữ', 'ữ'), (62, 'Ự', 'ự'),
    (63, 'Ý', 'ý'), (64, 'Ỳ', 'ỳ'), (65, 'Ỷ', 'ỷ'), (66, 'Ỹ', 'ỹ'), (67, 'Ỵ', 'ỵ')
),
existing_options AS (
  SELECT
    existing.entity_key,
    COALESCE(NULLIF(CAST(json_extract(existing.value_json, '$.kind') AS TEXT), ''), 'occupation') AS kind,
    CAST(json_extract(existing.value_json, '$.id') AS TEXT) AS id,
    upper(trim(CAST(json_extract(existing.value_json, '$.code') AS TEXT))) AS code,
    COALESCE(
      NULLIF(trim(CAST(json_extract(existing.value_json, '$.normalizedLabel') AS TEXT)), ''),
      trim(CAST(json_extract(existing.value_json, '$.label') AS TEXT)),
      ''
    ) AS comparable_label
  FROM state_entities AS existing
  WHERE existing.scope_key = 'global'
    AND existing.collection_key = 'orderInformationOptions'
),
folded_existing_labels (entity_key, kind, id, code, folded_label, fold_step) AS (
  SELECT entity_key, kind, id, code, lower(comparable_label), 0
  FROM existing_options
  UNION ALL
  SELECT
    folded.entity_key,
    folded.kind,
    folded.id,
    folded.code,
    replace(folded.folded_label, mapping.uppercase_character, mapping.lowercase_character),
    mapping.fold_step
  FROM folded_existing_labels AS folded
  JOIN vietnamese_case_map AS mapping
    ON mapping.fold_step = folded.fold_step + 1
),
normalized_existing AS (
  SELECT entity_key, kind, id, code, folded_label AS normalized_label
  FROM folded_existing_labels
  WHERE fold_step = (SELECT MAX(fold_step) FROM vietnamese_case_map)
),
encoded_seed AS (
  SELECT
    seed.*,
    json_object(
      'id', seed.id,
      'kind', seed.kind,
      'code', seed.code,
      'label', seed.label,
      'normalizedLabel', seed.normalized_label,
      'active', json('true'),
      'sortOrder', seed.sort_order,
      'system', json(seed.system_value),
      'createdAt', '2026-08-25T00:00:00+07:00',
      'createdBy', 'SYSTEM',
      'updatedAt', '2026-08-25T00:00:00+07:00',
      'updatedBy', 'SYSTEM',
      'deletedAt', NULL,
      'deletedBy', NULL
    ) AS value_json
  FROM order_information_seed AS seed
)
INSERT INTO state_entities (
  scope_key, collection_key, entity_key, entity_order,
  value_json, value_bytes, created_at, updated_at
)
SELECT
  'global',
  'orderInformationOptions',
  'migration:0008:' || seed.id,
  seed.sort_order * 10000,
  seed.value_json,
  length(CAST(seed.value_json AS BLOB)),
  '2026-08-25T00:00:00+07:00',
  '2026-08-25T00:00:00+07:00'
FROM encoded_seed AS seed
WHERE EXISTS (
  SELECT 1 FROM app_state WHERE scope_key = 'global'
)
AND NOT EXISTS (
  SELECT 1
  FROM normalized_existing AS existing
  WHERE (
      existing.id = seed.id
      OR existing.code = seed.code
      OR (
        existing.kind = seed.kind
        AND existing.normalized_label = seed.normalized_label
      )
    )
)
ON CONFLICT (scope_key, collection_key, entity_key) DO NOTHING;
--> statement-breakpoint

INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
SELECT
  'migration:0008:order-information-options',
  json_object(
    'collectionKey', 'orderInformationOptions',
    'canonicalSeedCount', 17,
    'occupationSeedCount', 15,
    'paymentMethodSeedCount', 2,
    'appliedAt', '2026-08-25T00:00:00+07:00'
  ),
  1,
  '2026-08-25T00:00:00+07:00'
FROM app_state
WHERE scope_key = 'global'
ON CONFLICT (meta_key) DO NOTHING;
--> statement-breakpoint

PRAGMA foreign_key_check;
--> statement-breakpoint

PRAGMA optimize;
