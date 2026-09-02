PRAGMA foreign_keys = ON;
--> statement-breakpoint

-- Query dimensions are stored beside the canonical JSON record so page reads
-- can use B-tree indexes instead of running json_extract over every entity.
-- The JSON document remains the source of truth; these nullable columns are
-- rebuilt on every entity upsert by the application.
ALTER TABLE state_entities ADD COLUMN store_id TEXT;
--> statement-breakpoint
ALTER TABLE state_entities ADD COLUMN employee_id TEXT;
--> statement-breakpoint
ALTER TABLE state_entities ADD COLUMN occurred_on TEXT;
--> statement-breakpoint
ALTER TABLE state_entities ADD COLUMN period_key TEXT;
--> statement-breakpoint
ALTER TABLE state_entities ADD COLUMN record_id TEXT;
--> statement-breakpoint
ALTER TABLE state_entities ADD COLUMN open_flag INTEGER;
--> statement-breakpoint

UPDATE state_entities
SET
  store_id = NULLIF(trim(CAST(COALESCE(
    json_extract(value_json, '$.storeId'),
    json_extract(value_json, '$.store_id'),
    json_extract(value_json, '$.supportStoreId'),
    json_extract(value_json, '$.toStoreId'),
    json_extract(value_json, '$.fromStoreId'),
    json_extract(value_json, '$.data.storeId'),
    json_extract(value_json, '$.order.storeId'),
    json_extract(value_json, '$.data.order.storeId')
  ) AS TEXT)), ''),
  employee_id = NULLIF(trim(CAST(COALESCE(
    json_extract(value_json, '$.employeeId'),
    json_extract(value_json, '$.employee_id'),
    json_extract(value_json, '$.staffId'),
    CASE WHEN collection_key IN ('employees', 'deletedEmployees')
      THEN json_extract(value_json, '$.id') END
  ) AS TEXT)), ''),
  occurred_on = substr(NULLIF(trim(CAST(COALESCE(
    json_extract(value_json, '$.effectiveDate'),
    json_extract(value_json, '$.businessDate'),
    json_extract(value_json, '$.occurredOn'),
    json_extract(value_json, '$.occurredAt'),
    json_extract(value_json, '$.date'),
    json_extract(value_json, '$.workDate'),
    json_extract(value_json, '$.createdAt'),
    json_extract(value_json, '$.updatedAt'),
    json_extract(value_json, '$.period'),
    json_extract(value_json, '$.month')
  ) AS TEXT)), ''), 1, 10),
  period_key = substr(NULLIF(trim(CAST(COALESCE(
    json_extract(value_json, '$.period'),
    json_extract(value_json, '$.month'),
    json_extract(value_json, '$.effectiveDate'),
    json_extract(value_json, '$.businessDate'),
    json_extract(value_json, '$.occurredOn'),
    json_extract(value_json, '$.occurredAt'),
    json_extract(value_json, '$.date'),
    json_extract(value_json, '$.workDate'),
    json_extract(value_json, '$.createdAt'),
    json_extract(value_json, '$.updatedAt')
  ) AS TEXT)), ''), 1, 7),
  record_id = NULLIF(trim(CAST(COALESCE(
    json_extract(value_json, '$.id'),
    json_extract(value_json, '$.code'),
    json_extract(value_json, '$.key'),
    json_extract(value_json, '$.periodId')
  ) AS TEXT)), ''),
  open_flag = CASE
    WHEN collection_key = 'attendance'
      AND json_extract(value_json, '$.deletedAt') IS NULL
      AND trim(COALESCE(CAST(json_extract(value_json, '$.checkOut') AS TEXT), '')) = ''
      AND trim(COALESCE(CAST(json_extract(value_json, '$.checkOutAt') AS TEXT), '')) = ''
    THEN 1
    WHEN collection_key = 'attendance' THEN 0
    ELSE NULL
  END;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_state_entities_store_history
ON state_entities (
  scope_key, collection_key, store_id COLLATE NOCASE,
  occurred_on DESC, entity_order DESC, entity_key DESC
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_state_entities_store_period
ON state_entities (
  scope_key, collection_key, store_id COLLATE NOCASE,
  period_key, entity_order DESC, entity_key DESC
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_state_entities_period_store
ON state_entities (
  scope_key, collection_key, period_key,
  store_id COLLATE NOCASE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_state_entities_employee_history
ON state_entities (
  scope_key, collection_key, employee_id COLLATE NOCASE,
  occurred_on DESC, entity_order DESC, entity_key DESC
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_state_entities_record_lookup
ON state_entities (
  scope_key, collection_key, record_id COLLATE NOCASE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_state_entities_open_attendance
ON state_entities (scope_key, collection_key, open_flag, store_id COLLATE NOCASE);
--> statement-breakpoint

-- Audit rows are immutable history for Save/Create/Edit/Delete operations.
-- This index keeps entity timelines paginatable as the log grows.
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_history
ON audit_log (entity_type, entity_id, id DESC);
