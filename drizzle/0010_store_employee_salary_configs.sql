PRAGMA foreign_keys = ON;
--> statement-breakpoint

-- Register the additive row-per-entity collection used by tiered Full-Time
-- store payroll. Existing employee salary fields and closed payroll snapshots
-- remain untouched for backward compatibility and rollback safety.
INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
SELECT app.scope_key, 'storeEmployeeSalaryConfigs', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM app_state AS app
WHERE app.scope_key = 'global'
ON CONFLICT (scope_key, collection_key) DO NOTHING;
--> statement-breakpoint

PRAGMA foreign_key_check;
--> statement-breakpoint

PRAGMA optimize;
--> statement-breakpoint
