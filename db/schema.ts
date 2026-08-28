/**
 * Logical D1 schema catalog for the IDOSI Worker.
 *
 * Runtime access intentionally uses prepared D1 statements in server/worker.js.
 * The executable schema is defined by the inspected SQL migrations in
 * drizzle/; this file keeps the data contract typed without adding a runtime
 * ORM to the static Vite application.
 */

export type UserRole = 'admin' | 'business_support' | 'store_manager' | 'employee'
export type AccountStatus = 'active' | 'locked' | 'inactive'

export const schema = {
  systemMetadata: {
    table: 'system_metadata',
    primaryKey: ['meta_key'],
    columns: ['meta_key', 'value_json', 'version', 'updated_at'],
  },
  users: {
    primaryKey: ['id'],
    unique: [['username_normalized'], ['employee_id']],
    columns: [
      'id',
      'username',
      'username_normalized',
      'display_name',
      'password_hash',
      'password_salt',
      'password_iterations',
      'password_algorithm',
      'role',
      'status',
      'version',
      'store_id',
      'employee_id',
      'last_login_at',
      'password_updated_at',
      'created_at',
      'updated_at',
    ],
  },
  appState: {
    table: 'app_state',
    primaryKey: ['scope_key'],
    versionColumn: 'version',
    columns: ['scope_key', 'value_json', 'version', 'updated_at', 'updated_by', 'last_request_id'],
  },
  policies: {
    primaryKey: ['policy_key'],
    versionColumn: 'version',
    columns: [
      'policy_key',
      'value_json',
      'version',
      'effective_at',
      'updated_at',
      'updated_by',
      'last_request_id',
    ],
  },
  auditLog: {
    table: 'audit_log',
    primaryKey: ['id'],
    unique: [['request_id']],
    columns: [
      'id',
      'request_id',
      'actor_id',
      'actor_role',
      'action',
      'entity_type',
      'entity_id',
      'before_json',
      'after_json',
      'metadata_json',
      'server_timestamp',
    ],
  },
  counters: {
    primaryKey: ['counter_name'],
    versionColumn: 'version',
    columns: ['counter_name', 'counter_value', 'version', 'updated_at', 'last_request_id'],
  },
  sessions: {
    primaryKey: ['id'],
    unique: [['token_hash']],
    columns: [
      'id',
      'token_hash',
      'user_id',
      'created_at',
      'last_seen_at',
      'expires_at',
      'revoked_at',
      'user_agent',
      'ip_address',
    ],
  },
  commandReceipts: {
    table: 'command_receipts',
    primaryKey: ['actor_id', 'idempotency_key'],
    columns: ['actor_id', 'idempotency_key', 'request_hash', 'response_json', 'status_code', 'created_at'],
  },
  stateCollections: {
    table: 'state_collections',
    primaryKey: ['scope_key', 'collection_key'],
    columns: ['scope_key', 'collection_key', 'created_at', 'updated_at'],
  },
  stateEntities: {
    table: 'state_entities',
    primaryKey: ['scope_key', 'collection_key', 'entity_key'],
    columns: [
      'scope_key',
      'collection_key',
      'entity_key',
      'entity_order',
      'value_json',
      'value_bytes',
      'created_at',
      'updated_at',
    ],
  },
  commandReceiptChunks: {
    table: 'command_receipt_chunks',
    primaryKey: ['actor_id', 'idempotency_key', 'chunk_index'],
    columns: ['actor_id', 'idempotency_key', 'chunk_index', 'chunk_text', 'chunk_bytes', 'created_at'],
  },
} as const

export const migrations = [
  'drizzle/0000_idosi_core.sql',
  'drizzle/0001_manager_role.sql',
  'drizzle/0002_attendance_evaluation_policies.sql',
  'drizzle/0003_state_entities.sql',
  'drizzle/0004_operational_roles.sql',
  'drizzle/0005_admin_only_accounts.sql',
  'drizzle/0006_recursive_profile_secret_scrub.sql',
  'drizzle/0007_session_roles.sql',
  'drizzle/0008_order_information_options.sql',
  'drizzle/0009_compensation_foundation.sql',
  'drizzle/0010_store_employee_salary_configs.sql',
  'drizzle/0011_work_catalog.sql',
  'drizzle/0012_revenue_bonus_confirmation.sql',
] as const
