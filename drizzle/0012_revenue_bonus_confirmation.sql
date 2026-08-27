PRAGMA foreign_keys = ON;
--> statement-breakpoint

-- Revenue bonuses created before the draft/confirmation workflow were already
-- official payroll inputs. Preserve that meaning by marking only those legacy
-- active rows as confirmed; new calculations are written as DRAFT by runtime.
UPDATE state_entities
SET
  value_json = json_set(
    value_json,
    '$.status', 'CONFIRMED',
    '$.confirmedAt', COALESCE(json_extract(value_json, '$.approvedAt'), json_extract(value_json, '$.calculatedAt'), updated_at),
    '$.confirmedBy', COALESCE(json_extract(value_json, '$.approvedBy'), json_extract(value_json, '$.calculatedBy'))
  ),
  value_bytes = length(CAST(json_set(
    value_json,
    '$.status', 'CONFIRMED',
    '$.confirmedAt', COALESCE(json_extract(value_json, '$.approvedAt'), json_extract(value_json, '$.calculatedAt'), updated_at),
    '$.confirmedBy', COALESCE(json_extract(value_json, '$.approvedBy'), json_extract(value_json, '$.calculatedBy'))
  ) AS BLOB)),
  updated_at = CURRENT_TIMESTAMP
WHERE scope_key = 'global'
  AND collection_key IN ('revenueBonusDaily', 'revenueBonusAllocations')
  AND replace(lower(COALESCE(json_extract(value_json, '$.status'), 'approved')), 'Đ', 'đ')
    IN ('approved', 'active', 'confirmed', 'đã duyệt', 'đã xác nhận');
--> statement-breakpoint

-- Compatibility for installations that have not externalized these arrays.
UPDATE app_state
SET value_json = json_set(
  value_json,
  '$.revenueBonusDaily', COALESCE((
    SELECT json_group_array(json(CASE
      WHEN replace(lower(COALESCE(json_extract(row.value, '$.status'), 'approved')), 'Đ', 'đ') IN ('approved', 'active', 'confirmed', 'đã duyệt', 'đã xác nhận')
      THEN json_set(row.value, '$.status', 'CONFIRMED', '$.confirmedAt', COALESCE(json_extract(row.value, '$.approvedAt'), json_extract(row.value, '$.calculatedAt'), app_state.updated_at), '$.confirmedBy', COALESCE(json_extract(row.value, '$.approvedBy'), json_extract(row.value, '$.calculatedBy')))
      ELSE row.value END)) FROM json_each(value_json, '$.revenueBonusDaily') AS row
  ), json('[]')),
  '$.revenueBonusAllocations', COALESCE((
    SELECT json_group_array(json(CASE
      WHEN replace(lower(COALESCE(json_extract(row.value, '$.status'), 'approved')), 'Đ', 'đ') IN ('approved', 'active', 'confirmed', 'đã duyệt', 'đã xác nhận')
      THEN json_set(row.value, '$.status', 'CONFIRMED', '$.confirmedAt', COALESCE(json_extract(row.value, '$.approvedAt'), app_state.updated_at), '$.confirmedBy', json_extract(row.value, '$.approvedBy'))
      ELSE row.value END)) FROM json_each(value_json, '$.revenueBonusAllocations') AS row
  ), json('[]'))
), updated_at = CURRENT_TIMESTAMP
WHERE scope_key = 'global'
  AND (json_type(value_json, '$.revenueBonusDaily') = 'array' OR json_type(value_json, '$.revenueBonusAllocations') = 'array');
--> statement-breakpoint

PRAGMA foreign_key_check;
--> statement-breakpoint
PRAGMA optimize;
--> statement-breakpoint
