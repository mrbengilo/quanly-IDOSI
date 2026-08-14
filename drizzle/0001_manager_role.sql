PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint

CREATE TABLE users_role_sessions_backup AS
SELECT
  id, token_hash, user_id, created_at, last_seen_at, expires_at, revoked_at,
  user_agent, ip_address
FROM sessions;
--> statement-breakpoint

CREATE TABLE users_role_receipts_backup AS
SELECT
  actor_id, idempotency_key, request_hash, response_json, status_code, created_at
FROM command_receipts;
--> statement-breakpoint

CREATE TABLE users_role_app_state_refs_backup AS
SELECT scope_key, updated_by
FROM app_state
WHERE updated_by IS NOT NULL;
--> statement-breakpoint

CREATE TABLE users_role_policy_refs_backup AS
SELECT policy_key, updated_by
FROM policies
WHERE updated_by IS NOT NULL;
--> statement-breakpoint

CREATE TABLE users_role_audit_refs_backup AS
SELECT id, actor_id
FROM audit_log
WHERE actor_id IS NOT NULL;
--> statement-breakpoint

CREATE TABLE users_manager_role (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL CHECK (password_iterations BETWEEN 100000 AND 1000000),
  password_algorithm TEXT NOT NULL DEFAULT 'PBKDF2-SHA256' CHECK (password_algorithm = 'PBKDF2-SHA256'),
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'employee')),
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

INSERT INTO users_manager_role (
  id, username, username_normalized, display_name, password_hash, password_salt,
  password_iterations, password_algorithm, role, status, version, store_id,
  employee_id, last_login_at, password_updated_at, created_at, updated_at
)
SELECT
  id, username, username_normalized, display_name, password_hash, password_salt,
  password_iterations, password_algorithm, role, status, version, store_id,
  employee_id, last_login_at, password_updated_at, created_at, updated_at
FROM users;
--> statement-breakpoint

DROP TABLE users;
--> statement-breakpoint

ALTER TABLE users_manager_role RENAME TO users;
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
FROM users_role_sessions_backup;
--> statement-breakpoint

INSERT INTO command_receipts (
  actor_id, idempotency_key, request_hash, response_json, status_code, created_at
)
SELECT
  actor_id, idempotency_key, request_hash, response_json, status_code, created_at
FROM users_role_receipts_backup;
--> statement-breakpoint

UPDATE app_state
SET updated_by = (
  SELECT backup.updated_by
  FROM users_role_app_state_refs_backup AS backup
  WHERE backup.scope_key = app_state.scope_key
)
WHERE EXISTS (
  SELECT 1
  FROM users_role_app_state_refs_backup AS backup
  WHERE backup.scope_key = app_state.scope_key
);
--> statement-breakpoint

UPDATE policies
SET updated_by = (
  SELECT backup.updated_by
  FROM users_role_policy_refs_backup AS backup
  WHERE backup.policy_key = policies.policy_key
)
WHERE EXISTS (
  SELECT 1
  FROM users_role_policy_refs_backup AS backup
  WHERE backup.policy_key = policies.policy_key
);
--> statement-breakpoint

UPDATE audit_log
SET actor_id = (
  SELECT backup.actor_id
  FROM users_role_audit_refs_backup AS backup
  WHERE backup.id = audit_log.id
)
WHERE EXISTS (
  SELECT 1
  FROM users_role_audit_refs_backup AS backup
  WHERE backup.id = audit_log.id
);
--> statement-breakpoint

DROP TABLE users_role_sessions_backup;
--> statement-breakpoint

DROP TABLE users_role_receipts_backup;
--> statement-breakpoint

DROP TABLE users_role_app_state_refs_backup;
--> statement-breakpoint

DROP TABLE users_role_policy_refs_backup;
--> statement-breakpoint

DROP TABLE users_role_audit_refs_backup;
--> statement-breakpoint

PRAGMA foreign_key_check;
--> statement-breakpoint

PRAGMA optimize;
