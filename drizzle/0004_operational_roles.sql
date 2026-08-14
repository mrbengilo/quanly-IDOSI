PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint

-- Deployment policy: keep only Admin credentials. Business data lives in
-- app_state/state_entities and is deliberately not deleted by this migration.
-- Admin-owned sessions and receipts survive the users-table rebuild; every
-- non-admin login, session and idempotency receipt is purged by omission.
CREATE TABLE users_roles_sessions_backup AS
SELECT
  session.id, session.token_hash, session.user_id, session.created_at,
  session.last_seen_at, session.expires_at, session.revoked_at,
  session.user_agent, session.ip_address
FROM sessions AS session
INNER JOIN users AS actor ON actor.id = session.user_id
WHERE actor.role = 'admin';
--> statement-breakpoint

CREATE TABLE users_roles_receipts_backup AS
SELECT
  receipt.actor_id, receipt.idempotency_key, receipt.request_hash,
  receipt.response_json, receipt.status_code, receipt.created_at
FROM command_receipts AS receipt
INNER JOIN users AS actor ON actor.id = receipt.actor_id
WHERE actor.role = 'admin';
--> statement-breakpoint

CREATE TABLE users_roles_receipt_chunks_backup AS
SELECT
  chunk.actor_id, chunk.idempotency_key, chunk.chunk_index,
  chunk.chunk_text, chunk.chunk_bytes, chunk.created_at
FROM command_receipt_chunks AS chunk
INNER JOIN users AS actor ON actor.id = chunk.actor_id
WHERE actor.role = 'admin';
--> statement-breakpoint

CREATE TABLE users_roles_app_state_refs_backup AS
SELECT state.scope_key, state.updated_by
FROM app_state AS state
INNER JOIN users AS actor ON actor.id = state.updated_by
WHERE actor.role = 'admin';
--> statement-breakpoint

CREATE TABLE users_roles_policy_refs_backup AS
SELECT policy.policy_key, policy.updated_by
FROM policies AS policy
INNER JOIN users AS actor ON actor.id = policy.updated_by
WHERE actor.role = 'admin';
--> statement-breakpoint

CREATE TABLE users_roles_audit_refs_backup AS
SELECT audit.id, audit.actor_id
FROM audit_log AS audit
INNER JOIN users AS actor ON actor.id = audit.actor_id
WHERE actor.role = 'admin';
--> statement-breakpoint

CREATE TABLE users_operational_roles (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL CHECK (password_iterations BETWEEN 100000 AND 1000000),
  password_algorithm TEXT NOT NULL DEFAULT 'PBKDF2-SHA256' CHECK (password_algorithm = 'PBKDF2-SHA256'),
  role TEXT NOT NULL CHECK (role IN ('admin', 'business_support', 'store_manager', 'employee')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked', 'inactive')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  store_id TEXT,
  employee_id TEXT,
  last_login_at TEXT,
  password_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
--> statement-breakpoint

INSERT INTO users_operational_roles (
  id, username, username_normalized, display_name, password_hash, password_salt,
  password_iterations, password_algorithm, role, status, version, store_id,
  employee_id, last_login_at, password_updated_at, created_at, updated_at
)
SELECT
  source.id,
  source.username,
  source.username_normalized,
  source.display_name,
  source.password_hash,
  source.password_salt,
  source.password_iterations,
  source.password_algorithm,
  'admin',
  source.status,
  source.version,
  source.store_id,
  source.employee_id,
  source.last_login_at,
  source.password_updated_at,
  source.created_at,
  source.updated_at
FROM users AS source
WHERE source.role = 'admin';
--> statement-breakpoint

DROP TABLE users;
--> statement-breakpoint

ALTER TABLE users_operational_roles RENAME TO users;
--> statement-breakpoint

CREATE UNIQUE INDEX idx_users_username_normalized
ON users (username_normalized);
--> statement-breakpoint

CREATE INDEX idx_users_role_status
ON users (role, status);
--> statement-breakpoint

CREATE INDEX idx_users_store_id
ON users (store_id)
WHERE store_id IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX idx_users_employee_id
ON users (employee_id)
WHERE employee_id IS NOT NULL;
--> statement-breakpoint

INSERT INTO sessions (
  id, token_hash, user_id, created_at, last_seen_at, expires_at, revoked_at,
  user_agent, ip_address
)
SELECT
  id, token_hash, user_id, created_at, last_seen_at, expires_at, revoked_at,
  user_agent, ip_address
FROM users_roles_sessions_backup;
--> statement-breakpoint

INSERT INTO command_receipts (
  actor_id, idempotency_key, request_hash, response_json, status_code, created_at
)
SELECT
  actor_id, idempotency_key, request_hash, response_json, status_code, created_at
FROM users_roles_receipts_backup;
--> statement-breakpoint

INSERT INTO command_receipt_chunks (
  actor_id, idempotency_key, chunk_index, chunk_text, chunk_bytes, created_at
)
SELECT
  actor_id, idempotency_key, chunk_index, chunk_text, chunk_bytes, created_at
FROM users_roles_receipt_chunks_backup;
--> statement-breakpoint

UPDATE app_state
SET updated_by = (
  SELECT backup.updated_by
  FROM users_roles_app_state_refs_backup AS backup
  WHERE backup.scope_key = app_state.scope_key
)
WHERE EXISTS (
  SELECT 1
  FROM users_roles_app_state_refs_backup AS backup
  WHERE backup.scope_key = app_state.scope_key
);
--> statement-breakpoint

UPDATE policies
SET updated_by = (
  SELECT backup.updated_by
  FROM users_roles_policy_refs_backup AS backup
  WHERE backup.policy_key = policies.policy_key
)
WHERE EXISTS (
  SELECT 1
  FROM users_roles_policy_refs_backup AS backup
  WHERE backup.policy_key = policies.policy_key
);
--> statement-breakpoint

UPDATE audit_log
SET actor_id = (
  SELECT backup.actor_id
  FROM users_roles_audit_refs_backup AS backup
  WHERE backup.id = audit_log.id
)
WHERE EXISTS (
  SELECT 1
  FROM users_roles_audit_refs_backup AS backup
  WHERE backup.id = audit_log.id
);
--> statement-breakpoint

-- Profiles and business history remain, but credential linkage is removed so
-- the UI correctly requires Admin to issue a fresh account.
UPDATE state_entities
SET
  value_json = json_remove(
    value_json,
    '$.username', '$.authUserId', '$.authVersion',
    '$.password', '$.passwordHash', '$.legacyPassword', '$.token'
  ),
  value_bytes = length(CAST(json_remove(
    value_json,
    '$.username', '$.authUserId', '$.authVersion',
    '$.password', '$.passwordHash', '$.legacyPassword', '$.token'
  ) AS BLOB)),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE scope_key = 'global'
  AND collection_key IN ('employees', 'deletedEmployees');
--> statement-breakpoint

UPDATE app_state
SET value_json = json_set(
  value_json,
  '$.employees', json((
    SELECT json_group_array(json(json_remove(
      entry.value,
      '$.username', '$.authUserId', '$.authVersion',
      '$.password', '$.passwordHash', '$.legacyPassword', '$.token'
    )))
    FROM json_each(app_state.value_json, '$.employees') AS entry
  ))
)
WHERE scope_key = 'global' AND json_type(value_json, '$.employees') = 'array';
--> statement-breakpoint

UPDATE app_state
SET value_json = json_set(
  value_json,
  '$.deletedEmployees', json((
    SELECT json_group_array(json(json_remove(
      entry.value,
      '$.username', '$.authUserId', '$.authVersion',
      '$.password', '$.passwordHash', '$.legacyPassword', '$.token'
    )))
    FROM json_each(app_state.value_json, '$.deletedEmployees') AS entry
  ))
)
WHERE scope_key = 'global' AND json_type(value_json, '$.deletedEmployees') = 'array';
--> statement-breakpoint

UPDATE app_state
SET value_json = json_set(
  value_json,
  '$.accountSettings', json((
    SELECT json_group_object(settings.key, json(settings.value))
    FROM json_each(app_state.value_json, '$.accountSettings') AS settings
    INNER JOIN users AS admin ON admin.id = settings.key AND admin.role = 'admin'
  ))
)
WHERE scope_key = 'global' AND json_type(value_json, '$.accountSettings') = 'object';
--> statement-breakpoint

UPDATE app_state
SET
  version = version + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  last_request_id = 'migration:0004:admin-only-credentials'
WHERE scope_key = 'global';
--> statement-breakpoint

DROP TABLE users_roles_sessions_backup;
--> statement-breakpoint

DROP TABLE users_roles_receipts_backup;
--> statement-breakpoint

DROP TABLE users_roles_receipt_chunks_backup;
--> statement-breakpoint

DROP TABLE users_roles_app_state_refs_backup;
--> statement-breakpoint

DROP TABLE users_roles_policy_refs_backup;
--> statement-breakpoint

DROP TABLE users_roles_audit_refs_backup;
--> statement-breakpoint

PRAGMA foreign_key_check;
--> statement-breakpoint

PRAGMA optimize;
