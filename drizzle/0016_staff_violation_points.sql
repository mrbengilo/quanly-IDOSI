-- Office and business-support violation definitions adopt points, matching store
-- violations. Existing configured points and custom definitions are preserved; custom
-- items stay "Chưa cài điểm" until Admin configures them. No violation, payroll or
-- attendance history is converted.
CREATE TABLE _violation_point_defaults (code TEXT PRIMARY KEY, points REAL NOT NULL);
--> statement-breakpoint
INSERT INTO _violation_point_defaults VALUES
  ('office.violation.late', 0.5),
  ('office.violation.forgot_attendance', 0.5),
  ('htkd.violation.late', 0.5),
  ('htkd.violation.forgot_attendance', 0.5),
  ('htkd.violation.assigned_store_error_requires_admin', 0.5);
--> statement-breakpoint
UPDATE app_state SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE scope_key IN (SELECT scope_key FROM state_entities WHERE collection_key = 'workCatalogItems' AND json_extract(value_json, '$.targetGroup') IN ('office', 'business_support') AND json_extract(value_json, '$.kind') = 'VIOLATION' AND json_extract(value_json, '$.violationPoints') IS NULL AND json_extract(value_json, '$.code') IN (SELECT code FROM _violation_point_defaults));
--> statement-breakpoint
UPDATE state_entities
SET value_json = json_set(value_json, '$.violationPoints', (SELECT points FROM _violation_point_defaults WHERE code = json_extract(value_json, '$.code')), '$.amountVnd', 0, '$.version', COALESCE(json_extract(value_json, '$.version'), 1) + 1, '$.updatedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), value_bytes = length(CAST(json_set(value_json, '$.violationPoints', (SELECT points FROM _violation_point_defaults WHERE code = json_extract(value_json, '$.code')), '$.amountVnd', 0, '$.version', COALESCE(json_extract(value_json, '$.version'), 1) + 1, '$.updatedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS BLOB)), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE collection_key = 'workCatalogItems' AND json_extract(value_json, '$.targetGroup') IN ('office', 'business_support') AND json_extract(value_json, '$.kind') = 'VIOLATION' AND json_extract(value_json, '$.violationPoints') IS NULL AND json_extract(value_json, '$.code') IN (SELECT code FROM _violation_point_defaults);
--> statement-breakpoint
DROP TABLE _violation_point_defaults;
