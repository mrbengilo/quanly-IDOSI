-- Known store catalog definitions adopt points; existing configured points and custom
-- definitions are preserved. No violation, payroll or attendance history is converted.
CREATE TABLE _violation_point_defaults (code TEXT PRIMARY KEY, points REAL NOT NULL);
--> statement-breakpoint
INSERT INTO _violation_point_defaults VALUES
  ('store.violation.late', 0.5),
  ('store.violation.forgot_attendance', 0.5),
  ('store.violation.ignore_customer', 2),
  ('store.violation.dark_hot_no_music', 0.5),
  ('store.violation.dirty_restroom', 1),
  ('store.violation.dirty_altar_table', 1),
  ('store.violation.dirty_floor', 1),
  ('store.violation.clothes_or_hangers_on_floor', 0.5),
  ('store.violation.empty_hangers', 0.5),
  ('store.violation.empty_rack_not_filled', 0.5),
  ('store.violation.no_sorting', 0.5),
  ('store.violation.wrong_payment_location', 0.5),
  ('store.violation.wrong_app_info_requires_manager', 0.5),
  ('store.violation.merged_or_wrong_time_order', 0.5),
  ('store.violation.phone_over_30_minutes', 1);
--> statement-breakpoint
UPDATE app_state SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE scope_key IN (SELECT scope_key FROM state_entities WHERE collection_key = 'workCatalogItems' AND json_extract(value_json, '$.targetGroup') = 'store' AND json_extract(value_json, '$.kind') = 'VIOLATION' AND json_extract(value_json, '$.violationPoints') IS NULL AND json_extract(value_json, '$.code') IN (SELECT code FROM _violation_point_defaults));
--> statement-breakpoint
UPDATE state_entities
SET value_json = json_set(value_json, '$.violationPoints', (SELECT points FROM _violation_point_defaults WHERE code = json_extract(value_json, '$.code')), '$.amountVnd', 0, '$.version', COALESCE(json_extract(value_json, '$.version'), 1) + 1, '$.updatedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), value_bytes = length(CAST(json_set(value_json, '$.violationPoints', (SELECT points FROM _violation_point_defaults WHERE code = json_extract(value_json, '$.code')), '$.amountVnd', 0, '$.version', COALESCE(json_extract(value_json, '$.version'), 1) + 1, '$.updatedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS BLOB)), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE collection_key = 'workCatalogItems' AND json_extract(value_json, '$.targetGroup') = 'store' AND json_extract(value_json, '$.kind') = 'VIOLATION' AND json_extract(value_json, '$.violationPoints') IS NULL AND json_extract(value_json, '$.code') IN (SELECT code FROM _violation_point_defaults);
--> statement-breakpoint
DROP TABLE _violation_point_defaults;
