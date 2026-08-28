PRAGMA foreign_keys = ON;
--> statement-breakpoint

-- Revenue bonuses created before the draft/confirmation workflow were already
-- official payroll inputs. SQLite lower() only folds ASCII, so explicitly fold
-- the Vietnamese uppercase characters used by the canonical payroll statuses.
-- Exact canonical CONFIRMED rows are excluded to make reruns write-free.
UPDATE state_entities
SET
  value_json = json_set(
    value_json,
    '$.status', 'CONFIRMED',
    '$.confirmedAt', COALESCE(json_extract(value_json, '$.confirmedAt'), json_extract(value_json, '$.approvedAt'), json_extract(value_json, '$.calculatedAt'), updated_at),
    '$.confirmedBy', COALESCE(json_extract(value_json, '$.confirmedBy'), json_extract(value_json, '$.approvedBy'), json_extract(value_json, '$.calculatedBy'))
  ),
  value_bytes = length(CAST(json_set(
    value_json,
    '$.status', 'CONFIRMED',
    '$.confirmedAt', COALESCE(json_extract(value_json, '$.confirmedAt'), json_extract(value_json, '$.approvedAt'), json_extract(value_json, '$.calculatedAt'), updated_at),
    '$.confirmedBy', COALESCE(json_extract(value_json, '$.confirmedBy'), json_extract(value_json, '$.approvedBy'), json_extract(value_json, '$.calculatedBy'))
  ) AS BLOB)),
  updated_at = CURRENT_TIMESTAMP
WHERE scope_key = 'global'
  AND collection_key IN ('revenueBonusDaily', 'revenueBonusAllocations')
  AND json_extract(value_json, '$.status') <> 'CONFIRMED'
  AND lower(replace(replace(replace(replace(replace(replace(trim(json_extract(value_json, '$.status')), 'Đ', 'đ'), 'Ã', 'ã'), 'Ệ', 'ệ'), 'Á', 'á'), 'Ậ', 'ậ'), 'Ắ', 'ắ'))
    IN ('approved', 'active', 'confirmed', 'đã duyệt', 'đã xác nhận');
--> statement-breakpoint

-- Compatibility for installations that have not externalized these arrays.
-- The EXISTS guard is part of the persistence contract: a canonical/empty row
-- must not be rewritten and must retain its raw JSON and audit timestamp.
UPDATE app_state
SET value_json = json_set(
  value_json,
  '$.revenueBonusDaily', CASE WHEN json_type(value_json, '$.revenueBonusDaily') = 'array' THEN (
    SELECT json_group_array(json(CASE
      WHEN json_extract(row.value, '$.status') <> 'CONFIRMED'
        AND lower(replace(replace(replace(replace(replace(replace(trim(json_extract(row.value, '$.status')), 'Đ', 'đ'), 'Ã', 'ã'), 'Ệ', 'ệ'), 'Á', 'á'), 'Ậ', 'ậ'), 'Ắ', 'ắ')) IN ('approved', 'active', 'confirmed', 'đã duyệt', 'đã xác nhận')
      THEN json_set(row.value, '$.status', 'CONFIRMED', '$.confirmedAt', COALESCE(json_extract(row.value, '$.confirmedAt'), json_extract(row.value, '$.approvedAt'), json_extract(row.value, '$.calculatedAt'), app_state.updated_at), '$.confirmedBy', COALESCE(json_extract(row.value, '$.confirmedBy'), json_extract(row.value, '$.approvedBy'), json_extract(row.value, '$.calculatedBy')))
      ELSE row.value END)) FROM json_each(value_json, '$.revenueBonusDaily') AS row
  ) ELSE json_extract(value_json, '$.revenueBonusDaily') END,
  '$.revenueBonusAllocations', CASE WHEN json_type(value_json, '$.revenueBonusAllocations') = 'array' THEN (
    SELECT json_group_array(json(CASE
      WHEN json_extract(row.value, '$.status') <> 'CONFIRMED'
        AND lower(replace(replace(replace(replace(replace(replace(trim(json_extract(row.value, '$.status')), 'Đ', 'đ'), 'Ã', 'ã'), 'Ệ', 'ệ'), 'Á', 'á'), 'Ậ', 'ậ'), 'Ắ', 'ắ')) IN ('approved', 'active', 'confirmed', 'đã duyệt', 'đã xác nhận')
      THEN json_set(row.value, '$.status', 'CONFIRMED', '$.confirmedAt', COALESCE(json_extract(row.value, '$.confirmedAt'), json_extract(row.value, '$.approvedAt'), app_state.updated_at), '$.confirmedBy', COALESCE(json_extract(row.value, '$.confirmedBy'), json_extract(row.value, '$.approvedBy')))
      ELSE row.value END)) FROM json_each(value_json, '$.revenueBonusAllocations') AS row
  ) ELSE json_extract(value_json, '$.revenueBonusAllocations') END
), updated_at = CURRENT_TIMESTAMP
WHERE scope_key = 'global'
  AND (
    EXISTS (SELECT 1 FROM json_each(value_json, '$.revenueBonusDaily') AS row
      WHERE json_extract(row.value, '$.status') <> 'CONFIRMED'
        AND lower(replace(replace(replace(replace(replace(replace(trim(json_extract(row.value, '$.status')), 'Đ', 'đ'), 'Ã', 'ã'), 'Ệ', 'ệ'), 'Á', 'á'), 'Ậ', 'ậ'), 'Ắ', 'ắ')) IN ('approved', 'active', 'confirmed', 'đã duyệt', 'đã xác nhận'))
    OR EXISTS (SELECT 1 FROM json_each(value_json, '$.revenueBonusAllocations') AS row
      WHERE json_extract(row.value, '$.status') <> 'CONFIRMED'
        AND lower(replace(replace(replace(replace(replace(replace(trim(json_extract(row.value, '$.status')), 'Đ', 'đ'), 'Ã', 'ã'), 'Ệ', 'ệ'), 'Á', 'á'), 'Ậ', 'ậ'), 'Ắ', 'ắ')) IN ('approved', 'active', 'confirmed', 'đã duyệt', 'đã xác nhận'))
  );
--> statement-breakpoint

PRAGMA foreign_key_check;
--> statement-breakpoint
PRAGMA optimize;
--> statement-breakpoint
