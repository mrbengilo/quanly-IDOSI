INSERT OR IGNORE INTO policies (
  policy_key,
  value_json,
  version,
  effective_at,
  updated_at,
  updated_by,
  last_request_id
) VALUES
  (
    'attendance_maintain_max_late_count',
    '2',
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    NULL,
    'migration:0002:attendance-maintain-max-late-count'
  ),
  (
    'attendance_improve_min_late_count',
    '3',
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    NULL,
    'migration:0002:attendance-improve-min-late-count'
  ),
  (
    'attendance_improve_min_late_minutes',
    '30',
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    NULL,
    'migration:0002:attendance-improve-min-late-minutes'
  );
--> statement-breakpoint

PRAGMA optimize;
