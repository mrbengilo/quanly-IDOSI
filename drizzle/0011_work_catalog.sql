PRAGMA foreign_keys = ON;
--> statement-breakpoint

-- Register additive row-per-entity collections for configurable fixed work,
-- reward work, violations, and per-shift progress. Existing assignments,
-- checklist snapshots, violations, and attendance history remain untouched.
INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
SELECT app.scope_key, 'workCatalogItems', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM app_state AS app
WHERE app.scope_key = 'global'
ON CONFLICT (scope_key, collection_key) DO NOTHING;
--> statement-breakpoint

INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
SELECT app.scope_key, 'workCatalogProgress', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM app_state AS app
WHERE app.scope_key = 'global'
ON CONFLICT (scope_key, collection_key) DO NOTHING;
--> statement-breakpoint

PRAGMA foreign_key_check;
--> statement-breakpoint

PRAGMA optimize;
--> statement-breakpoint
