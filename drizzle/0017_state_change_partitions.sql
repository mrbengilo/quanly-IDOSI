PRAGMA foreign_keys = ON;
--> statement-breakpoint

-- Open screens poll a change token for their own store instead of the single
-- global version, so one store's check-in no longer makes every open screen of
-- every store reload. Each commit records the partitions it touched:
-- 'store:<id>' and 'employee:<id>' for rows of a store, '*' for rows that are
-- not attributed to one store. '#attributed' holds the last version committed
-- with this bookkeeping; a version bumped any other way (a data fix or a
-- migration) exceeds it, and every token then falls back to the global version.
CREATE TABLE IF NOT EXISTS state_change_partitions (
  scope_key TEXT NOT NULL,
  partition_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_key, partition_key),
  FOREIGN KEY (scope_key) REFERENCES app_state(scope_key) ON DELETE CASCADE
) WITHOUT ROWID, STRICT;
--> statement-breakpoint

-- Without '#attributed' tokens equal the global version, as before.
INSERT OR IGNORE INTO state_change_partitions (scope_key, partition_key, version, updated_at)
SELECT scope_key, '*', version, updated_at FROM app_state;
--> statement-breakpoint

PRAGMA foreign_key_check;
