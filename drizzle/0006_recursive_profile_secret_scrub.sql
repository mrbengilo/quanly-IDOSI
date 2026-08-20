PRAGMA foreign_keys = ON;
--> statement-breakpoint

PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint

-- Stage both storage layouts so the same recursive scrub is applied to active
-- and deleted employee profiles. The table is deliberately persistent for the
-- duration of the migration because D1 may execute statement breakpoints on
-- different pooled connections.
DROP TABLE IF EXISTS migration_0006_profile_scrub;
--> statement-breakpoint

CREATE TABLE migration_0006_profile_scrub (
  storage_kind TEXT NOT NULL CHECK (storage_kind IN ('split', 'compact')),
  scope_key TEXT NOT NULL,
  collection_key TEXT NOT NULL CHECK (collection_key IN ('employees', 'deletedEmployees')),
  entity_key TEXT NOT NULL,
  entity_order INTEGER NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  drop_profile INTEGER NOT NULL DEFAULT 0 CHECK (drop_profile IN (0, 1)),
  PRIMARY KEY (storage_kind, scope_key, collection_key, entity_key)
) WITHOUT ROWID, STRICT;
--> statement-breakpoint

INSERT INTO migration_0006_profile_scrub (
  storage_kind, scope_key, collection_key, entity_key, entity_order, value_json
)
SELECT
  'split', scope_key, collection_key, entity_key, entity_order, json(value_json)
FROM state_entities
WHERE scope_key = 'global'
  AND collection_key IN ('employees', 'deletedEmployees');
--> statement-breakpoint

WITH requested_collections(collection_key) AS (
  VALUES ('employees'), ('deletedEmployees')
)
INSERT INTO migration_0006_profile_scrub (
  storage_kind, scope_key, collection_key, entity_key, entity_order, value_json
)
SELECT
  'compact',
  app.scope_key,
  requested.collection_key,
  CAST(profile.key AS TEXT),
  CAST(profile.key AS INTEGER),
  CASE profile.type
    WHEN 'text' THEN json_quote(profile.atom)
    WHEN 'null' THEN 'null'
    WHEN 'true' THEN 'true'
    WHEN 'false' THEN 'false'
    ELSE json(profile.value)
  END
FROM app_state AS app
CROSS JOIN requested_collections AS requested
JOIN json_each(app.value_json, '$.' || requested.collection_key) AS profile ON 1 = 1
WHERE app.scope_key = 'global'
  AND json_type(app.value_json, '$.' || requested.collection_key) = 'array';
--> statement-breakpoint

-- SQLite has no built-in regexp replace, so normalize every JSON key one
-- character at a time, retaining only ASCII letters/digits exactly like the
-- Worker's normalizedStateKey. Descending json_tree ids remove deep/later array
-- paths first, preventing path invalidation as credential envelopes are pruned.
WITH RECURSIVE
profile_nodes AS (
  SELECT
    profile.storage_kind,
    profile.scope_key,
    profile.collection_key,
    profile.entity_key,
    node.id AS node_id,
    node.parent AS parent_id,
    node.fullkey AS full_key,
    node.type AS node_type,
    CAST(COALESCE(node.key, '') AS TEXT) AS raw_key
  FROM migration_0006_profile_scrub AS profile
  JOIN json_tree(profile.value_json) AS node ON 1 = 1
),
key_characters (
  storage_kind, scope_key, collection_key, entity_key,
  node_id, parent_id, full_key, node_type, raw_key, character_index, normalized_key
) AS (
  SELECT
    storage_kind, scope_key, collection_key, entity_key,
    node_id, parent_id, full_key, node_type, raw_key, 1, ''
  FROM profile_nodes
  UNION ALL
  SELECT
    storage_kind, scope_key, collection_key, entity_key,
    node_id, parent_id, full_key, node_type, raw_key, character_index + 1,
    normalized_key || CASE
      WHEN substr(lower(raw_key), character_index, 1) GLOB '[a-z0-9]'
        THEN substr(lower(raw_key), character_index, 1)
      ELSE ''
    END
  FROM key_characters
  WHERE character_index <= length(raw_key)
),
normalized_nodes AS (
  SELECT
    storage_kind, scope_key, collection_key, entity_key,
    node_id, parent_id, full_key, node_type, normalized_key
  FROM key_characters
  WHERE character_index = length(raw_key) + 1
),
credential_envelopes AS (
  SELECT
    container.storage_kind,
    container.scope_key,
    container.collection_key,
    container.entity_key,
    container.node_id,
    container.full_key
  FROM normalized_nodes AS container
  JOIN normalized_nodes AS child
    ON child.storage_kind = container.storage_kind
   AND child.scope_key = container.scope_key
   AND child.collection_key = container.collection_key
   AND child.entity_key = container.entity_key
   AND child.parent_id = container.node_id
  WHERE container.node_type = 'object'
  GROUP BY
    container.storage_kind, container.scope_key, container.collection_key,
    container.entity_key, container.node_id, container.full_key
  HAVING COUNT(DISTINCT CASE
    WHEN child.normalized_key IN ('hash', 'salt', 'iterations', 'algorithm')
      THEN child.normalized_key
  END) = 4
),
secret_targets AS (
  SELECT
    node.storage_kind,
    node.scope_key,
    node.collection_key,
    node.entity_key,
    node.node_id,
    node.full_key
  FROM normalized_nodes AS node
  WHERE node.full_key <> '$'
    AND (
      node.normalized_key IN (
        'password', 'passwordhash', 'passwordsalt', 'passworditerations',
        'legacypassword', 'token', 'tokenhash', 'accesstoken', 'refreshtoken',
        'apikey', 'secret', 'credential', 'credentials', 'authorization',
        'cookie', 'setcookie'
      )
      OR instr(node.normalized_key, 'password') > 0
      OR substr(node.normalized_key, -5) = 'token'
      OR substr(node.normalized_key, -9) = 'tokenhash'
      OR instr(node.normalized_key, 'accesstoken') > 0
      OR instr(node.normalized_key, 'refreshtoken') > 0
      OR instr(node.normalized_key, 'apikey') > 0
      OR instr(node.normalized_key, 'secret') > 0
      OR instr(node.normalized_key, 'credential') > 0
      OR instr(node.normalized_key, 'authorization') > 0
      OR instr(node.normalized_key, 'cookie') > 0
    )
  UNION
  SELECT
    storage_kind, scope_key, collection_key, entity_key, node_id, full_key
  FROM credential_envelopes
  WHERE full_key <> '$'
),
ordered_targets AS (
  SELECT
    storage_kind,
    scope_key,
    collection_key,
    entity_key,
    full_key,
    row_number() OVER (
      PARTITION BY storage_kind, scope_key, collection_key, entity_key
      ORDER BY node_id DESC, full_key DESC
    ) AS target_step
  FROM secret_targets
),
scrubbed_profiles (
  storage_kind, scope_key, collection_key, entity_key, target_step, value_json
) AS (
  SELECT
    storage_kind, scope_key, collection_key, entity_key, 0, value_json
  FROM migration_0006_profile_scrub
  UNION ALL
  SELECT
    scrubbed.storage_kind,
    scrubbed.scope_key,
    scrubbed.collection_key,
    scrubbed.entity_key,
    target.target_step,
    json_remove(scrubbed.value_json, target.full_key)
  FROM scrubbed_profiles AS scrubbed
  JOIN ordered_targets AS target
    ON target.storage_kind = scrubbed.storage_kind
   AND target.scope_key = scrubbed.scope_key
   AND target.collection_key = scrubbed.collection_key
   AND target.entity_key = scrubbed.entity_key
   AND target.target_step = scrubbed.target_step + 1
)
UPDATE migration_0006_profile_scrub AS profile
SET
  value_json = (
    SELECT scrubbed.value_json
    FROM scrubbed_profiles AS scrubbed
    WHERE scrubbed.storage_kind = profile.storage_kind
      AND scrubbed.scope_key = profile.scope_key
      AND scrubbed.collection_key = profile.collection_key
      AND scrubbed.entity_key = profile.entity_key
    ORDER BY scrubbed.target_step DESC
    LIMIT 1
  ),
  drop_profile = CASE WHEN EXISTS (
    SELECT 1
    FROM credential_envelopes AS envelope
    WHERE envelope.storage_kind = profile.storage_kind
      AND envelope.scope_key = profile.scope_key
      AND envelope.collection_key = profile.collection_key
      AND envelope.entity_key = profile.entity_key
      AND envelope.full_key = '$'
  ) THEN 1 ELSE 0 END;
--> statement-breakpoint

-- Root-level credential envelopes are not valid employee profiles. Runtime
-- array sanitation filters them out, so the migration mirrors that behavior.
DELETE FROM state_entities
WHERE EXISTS (
  SELECT 1
  FROM migration_0006_profile_scrub AS profile
  WHERE profile.storage_kind = 'split'
    AND profile.drop_profile = 1
    AND profile.scope_key = state_entities.scope_key
    AND profile.collection_key = state_entities.collection_key
    AND profile.entity_key = state_entities.entity_key
);
--> statement-breakpoint

UPDATE state_entities
SET
  value_json = (
    SELECT profile.value_json
    FROM migration_0006_profile_scrub AS profile
    WHERE profile.storage_kind = 'split'
      AND profile.drop_profile = 0
      AND profile.scope_key = state_entities.scope_key
      AND profile.collection_key = state_entities.collection_key
      AND profile.entity_key = state_entities.entity_key
  ),
  value_bytes = length(CAST((
    SELECT profile.value_json
    FROM migration_0006_profile_scrub AS profile
    WHERE profile.storage_kind = 'split'
      AND profile.drop_profile = 0
      AND profile.scope_key = state_entities.scope_key
      AND profile.collection_key = state_entities.collection_key
      AND profile.entity_key = state_entities.entity_key
  ) AS BLOB)),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE scope_key = 'global'
  AND collection_key IN ('employees', 'deletedEmployees')
  AND EXISTS (
    SELECT 1
    FROM migration_0006_profile_scrub AS profile
    WHERE profile.storage_kind = 'split'
      AND profile.drop_profile = 0
      AND profile.scope_key = state_entities.scope_key
      AND profile.collection_key = state_entities.collection_key
      AND profile.entity_key = state_entities.entity_key
      AND profile.value_json <> state_entities.value_json
  );
--> statement-breakpoint

UPDATE app_state
SET value_json = json_set(
  value_json,
  '$.employees',
  json(COALESCE((
    SELECT json_group_array(json(ordered_profile.value_json))
    FROM (
      SELECT profile.value_json
      FROM migration_0006_profile_scrub AS profile
      WHERE profile.storage_kind = 'compact'
        AND profile.scope_key = app_state.scope_key
        AND profile.collection_key = 'employees'
        AND profile.drop_profile = 0
      ORDER BY profile.entity_order, profile.entity_key
    ) AS ordered_profile
  ), '[]'))
)
WHERE scope_key = 'global'
  AND json_type(value_json, '$.employees') = 'array';
--> statement-breakpoint

UPDATE app_state
SET value_json = json_set(
  value_json,
  '$.deletedEmployees',
  json(COALESCE((
    SELECT json_group_array(json(ordered_profile.value_json))
    FROM (
      SELECT profile.value_json
      FROM migration_0006_profile_scrub AS profile
      WHERE profile.storage_kind = 'compact'
        AND profile.scope_key = app_state.scope_key
        AND profile.collection_key = 'deletedEmployees'
        AND profile.drop_profile = 0
      ORDER BY profile.entity_order, profile.entity_key
    ) AS ordered_profile
  ), '[]'))
)
WHERE scope_key = 'global'
  AND json_type(value_json, '$.deletedEmployees') = 'array';
--> statement-breakpoint

UPDATE app_state
SET
  version = version + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  last_request_id = 'migration:0006:recursive-profile-secret-scrub'
WHERE scope_key = 'global'
  AND COALESCE(last_request_id, '') <> 'migration:0006:recursive-profile-secret-scrub';
--> statement-breakpoint

DROP TABLE migration_0006_profile_scrub;
--> statement-breakpoint

PRAGMA foreign_key_check;
--> statement-breakpoint

PRAGMA optimize;
PRAGMA foreign_keys = ON;
--> statement-breakpoint
