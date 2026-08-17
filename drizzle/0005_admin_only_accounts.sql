PRAGMA foreign_keys = ON;
--> statement-breakpoint

PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint

-- One-time production cleanup: profiles and business history stay intact, but
-- every credential except Admin is removed. The declared foreign keys cascade
-- sessions/receipts/chunks and null historical actor/update references.
DELETE FROM users
WHERE role <> 'admin';
--> statement-breakpoint

-- Scrub root-level credential linkage from row-split active/deleted profiles.
-- Rebuilding each object instead of naming password fields individually also
-- removes future legacy keys whose name starts with "password".
WITH scrubbed AS (
  SELECT
    profile.scope_key,
    profile.collection_key,
    profile.entity_key,
    CASE
      WHEN json_type(profile.value_json) <> 'object' THEN profile.value_json
      ELSE (
        SELECT json_group_object(
          field.key,
          json(CASE field.type
            WHEN 'text' THEN json_quote(field.atom)
            WHEN 'null' THEN 'null'
            WHEN 'true' THEN 'true'
            WHEN 'false' THEN 'false'
            ELSE field.value
          END)
        )
        FROM json_each(profile.value_json) AS field
        WHERE lower(field.key) NOT IN (
          'username', 'authuserid', 'auth_user_id', 'authversion', 'auth_version'
        )
          AND lower(field.key) NOT LIKE 'password%'
      )
    END AS value_json
  FROM state_entities AS profile
  WHERE profile.scope_key = 'global'
    AND profile.collection_key IN ('employees', 'deletedEmployees')
)
UPDATE state_entities
SET
  value_json = (
    SELECT scrubbed.value_json
    FROM scrubbed
    WHERE scrubbed.scope_key = state_entities.scope_key
      AND scrubbed.collection_key = state_entities.collection_key
      AND scrubbed.entity_key = state_entities.entity_key
  ),
  value_bytes = length(CAST((
    SELECT scrubbed.value_json
    FROM scrubbed
    WHERE scrubbed.scope_key = state_entities.scope_key
      AND scrubbed.collection_key = state_entities.collection_key
      AND scrubbed.entity_key = state_entities.entity_key
  ) AS BLOB)),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE scope_key = 'global'
  AND collection_key IN ('employees', 'deletedEmployees');
--> statement-breakpoint

-- Some deployments can still contain the legacy compact arrays. Preserve item
-- order and values while applying the same credential scrub to each profile.
WITH scrubbed AS (
  SELECT
    app.scope_key,
    'employees' AS collection_key,
    CAST(profile.key AS INTEGER) AS array_index,
    CASE
      WHEN profile.type <> 'object' THEN
        CASE profile.type
          WHEN 'text' THEN json_quote(profile.atom)
          WHEN 'null' THEN 'null'
          WHEN 'true' THEN 'true'
          WHEN 'false' THEN 'false'
          ELSE json(profile.value)
        END
      ELSE (
        SELECT json_group_object(
          field.key,
          json(CASE field.type
            WHEN 'text' THEN json_quote(field.atom)
            WHEN 'null' THEN 'null'
            WHEN 'true' THEN 'true'
            WHEN 'false' THEN 'false'
            ELSE field.value
          END)
        )
        FROM json_each(profile.value) AS field
        WHERE lower(field.key) NOT IN (
          'username', 'authuserid', 'auth_user_id', 'authversion', 'auth_version'
        )
          AND lower(field.key) NOT LIKE 'password%'
      )
    END AS profile_json
  FROM app_state AS app
  JOIN json_each(app.value_json, '$.employees') AS profile ON 1 = 1
  WHERE app.scope_key = 'global'
    AND json_type(app.value_json, '$.employees') = 'array'
  ORDER BY app.scope_key, CAST(profile.key AS INTEGER)
),
rebuilt AS (
  SELECT scope_key, json_group_array(json(profile_json)) AS profiles_json
  FROM scrubbed
  GROUP BY scope_key
)
UPDATE app_state
SET value_json = json_set(
  value_json,
  '$.employees',
  json(COALESCE((
    SELECT rebuilt.profiles_json
    FROM rebuilt
    WHERE rebuilt.scope_key = app_state.scope_key
  ), '[]'))
)
WHERE scope_key = 'global'
  AND json_type(value_json, '$.employees') = 'array';
--> statement-breakpoint

WITH scrubbed AS (
  SELECT
    app.scope_key,
    'deletedEmployees' AS collection_key,
    CAST(profile.key AS INTEGER) AS array_index,
    CASE
      WHEN profile.type <> 'object' THEN
        CASE profile.type
          WHEN 'text' THEN json_quote(profile.atom)
          WHEN 'null' THEN 'null'
          WHEN 'true' THEN 'true'
          WHEN 'false' THEN 'false'
          ELSE json(profile.value)
        END
      ELSE (
        SELECT json_group_object(
          field.key,
          json(CASE field.type
            WHEN 'text' THEN json_quote(field.atom)
            WHEN 'null' THEN 'null'
            WHEN 'true' THEN 'true'
            WHEN 'false' THEN 'false'
            ELSE field.value
          END)
        )
        FROM json_each(profile.value) AS field
        WHERE lower(field.key) NOT IN (
          'username', 'authuserid', 'auth_user_id', 'authversion', 'auth_version'
        )
          AND lower(field.key) NOT LIKE 'password%'
      )
    END AS profile_json
  FROM app_state AS app
  JOIN json_each(app.value_json, '$.deletedEmployees') AS profile ON 1 = 1
  WHERE app.scope_key = 'global'
    AND json_type(app.value_json, '$.deletedEmployees') = 'array'
  ORDER BY app.scope_key, CAST(profile.key AS INTEGER)
),
rebuilt AS (
  SELECT scope_key, json_group_array(json(profile_json)) AS profiles_json
  FROM scrubbed
  GROUP BY scope_key
)
UPDATE app_state
SET value_json = json_set(
  value_json,
  '$.deletedEmployees',
  json(COALESCE((
    SELECT rebuilt.profiles_json
    FROM rebuilt
    WHERE rebuilt.scope_key = app_state.scope_key
  ), '[]'))
)
WHERE scope_key = 'global'
  AND json_type(value_json, '$.deletedEmployees') = 'array';
--> statement-breakpoint

-- Preferences are private per login; retain only settings owned by a surviving
-- Admin user and discard orphan/non-admin entries.
UPDATE app_state
SET value_json = json_set(
  value_json,
  '$.accountSettings',
  json(COALESCE((
    SELECT json_group_object(
      settings.key,
      json(CASE settings.type
        WHEN 'text' THEN json_quote(settings.atom)
        WHEN 'null' THEN 'null'
        WHEN 'true' THEN 'true'
        WHEN 'false' THEN 'false'
        ELSE settings.value
      END)
    )
    FROM json_each(app_state.value_json, '$.accountSettings') AS settings
    INNER JOIN users AS admin
      ON admin.id = settings.key AND admin.role = 'admin'
  ), '{}'))
)
WHERE scope_key = 'global'
  AND json_type(value_json, '$.accountSettings') = 'object';
--> statement-breakpoint

UPDATE app_state
SET
  version = version + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  last_request_id = 'migration:0005:admin-only-accounts'
WHERE scope_key = 'global';
--> statement-breakpoint

PRAGMA foreign_key_check;
--> statement-breakpoint

PRAGMA optimize;
