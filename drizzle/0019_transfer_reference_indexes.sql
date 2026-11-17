-- Preserve every legacy ID/code alias, but locate matching transfer history
-- without parsing unrelated attendance checklist JSON on every screen read.
CREATE INDEX idx_transfer_employeeId ON state_entities (
  scope_key, collection_key, lower(trim(CAST(json_extract(value_json, '$.employeeId') AS TEXT)))
) WHERE collection_key IN ('attendance', 'schedule');
--> statement-breakpoint
CREATE INDEX idx_transfer_employee_id ON state_entities (
  scope_key, collection_key, lower(trim(CAST(json_extract(value_json, '$.employee_id') AS TEXT)))
) WHERE collection_key IN ('attendance', 'schedule');
--> statement-breakpoint
CREATE INDEX idx_transfer_employeeCode ON state_entities (
  scope_key, collection_key, lower(trim(CAST(json_extract(value_json, '$.employeeCode') AS TEXT)))
) WHERE collection_key IN ('attendance', 'schedule');
--> statement-breakpoint
CREATE INDEX idx_transfer_employee_code ON state_entities (
  scope_key, collection_key, lower(trim(CAST(json_extract(value_json, '$.employee_code') AS TEXT)))
) WHERE collection_key IN ('attendance', 'schedule');
--> statement-breakpoint
CREATE INDEX idx_transfer_linked_attendance ON state_entities (scope_key, collection_key, entity_key)
WHERE collection_key = 'attendance' AND COALESCE(
  NULLIF(trim(CAST(json_extract(value_json, '$.supportTransferId') AS TEXT)), ''),
  NULLIF(trim(CAST(json_extract(value_json, '$.supportCompensation.transferId') AS TEXT)), '')
) IS NOT NULL;
