PRAGMA foreign_keys = ON;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS system_metadata (
  meta_key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL
) STRICT;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL CHECK (password_iterations BETWEEN 100000 AND 1000000),
  password_algorithm TEXT NOT NULL DEFAULT 'PBKDF2-SHA256' CHECK (password_algorithm = 'PBKDF2-SHA256'),
  role TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_normalized
ON users (username_normalized);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_users_role_status
ON users (role, status);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_users_store_id
ON users (store_id)
WHERE store_id IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_id
ON users (employee_id)
WHERE employee_id IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS app_state (
  scope_key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  last_request_id TEXT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) STRICT;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS policies (
  policy_key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  effective_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  last_request_id TEXT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) STRICT;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS counters (
  counter_name TEXT PRIMARY KEY NOT NULL,
  counter_value INTEGER NOT NULL DEFAULT 0 CHECK (counter_value >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  last_request_id TEXT
) STRICT;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT,
  ip_address TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash
ON sessions (token_hash);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_sessions_user_created
ON sessions (user_id, created_at DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_sessions_active_expiry
ON sessions (expires_at)
WHERE revoked_at IS NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  server_timestamp TEXT NOT NULL,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) STRICT;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_request_id
ON audit_log (request_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_audit_actor_timestamp
ON audit_log (actor_id, server_timestamp DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_audit_entity_timestamp
ON audit_log (entity_type, entity_id, server_timestamp DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_audit_timestamp
ON audit_log (server_timestamp DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS command_receipts (
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  status_code INTEGER NOT NULL CHECK (status_code BETWEEN 200 AND 599),
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_id, idempotency_key),
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
) WITHOUT ROWID, STRICT;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_command_receipts_created
ON command_receipts (created_at);
--> statement-breakpoint

PRAGMA optimize;
