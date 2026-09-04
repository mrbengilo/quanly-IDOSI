PRAGMA foreign_keys = ON;
--> statement-breakpoint

-- Register the additive row-per-entity collections used by the compensation
-- rollout. Existing state remains untouched; an empty collection is a valid
-- production state until the corresponding business flow creates records.
WITH compensation_collections(collection_key) AS (
  VALUES
    ('storeShiftTaskTemplates'),
    ('compensationEntries'),
    ('violations'),
    ('revenueBonusDaily'),
    ('revenueBonusAllocations'),
    ('teamRewardClaims'),
    ('teamRewardParticipants'),
    ('periodReconciliations'),
    ('jobRuns')
)
INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
SELECT app.scope_key, collection.collection_key, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM app_state AS app
CROSS JOIN compensation_collections AS collection
WHERE app.scope_key = 'global'
ON CONFLICT (scope_key, collection_key) DO NOTHING;
--> statement-breakpoint

-- The current compensation model has no performance-index bonus. Remove only
-- the three exact retired policy identities; no fuzzy predicate is used.
DELETE FROM policies
WHERE policy_key IN (
  'employee_kpi_percent_30000',
  'employee_kpi_percent_15000',
  'employee_kpi_percent_7000'
);
--> statement-breakpoint

-- Payroll periods can live as external state entities. Remove the retired
-- snapshot and per-row bonus field while preserving every other field/row.
UPDATE state_entities
SET
  value_json = CASE
    WHEN json_type(value_json, '$.rows') = 'array' THEN
      json_set(
        json_remove(value_json, '$.kpiSnapshot'),
        '$.rows',
        COALESCE(
          (
            SELECT json_group_array(json(json_remove(row.value, '$.kpiBonus')))
            FROM json_each(state_entities.value_json, '$.rows') AS row
          ),
          json('[]')
        )
      )
    ELSE json_remove(value_json, '$.kpiSnapshot')
  END,
  value_bytes = length(CAST(
    CASE
      WHEN json_type(value_json, '$.rows') = 'array' THEN
        json_set(
          json_remove(value_json, '$.kpiSnapshot'),
          '$.rows',
          COALESCE(
            (
              SELECT json_group_array(json(json_remove(row.value, '$.kpiBonus')))
              FROM json_each(state_entities.value_json, '$.rows') AS row
            ),
            json('[]')
          )
        )
      ELSE json_remove(value_json, '$.kpiSnapshot')
    END AS BLOB
  )),
  updated_at = CURRENT_TIMESTAMP
WHERE scope_key = 'global'
  AND collection_key = 'payrollPeriods'
  AND (
    json_type(value_json, '$.kpiSnapshot') IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM json_each(value_json, '$.rows') AS row
      WHERE json_type(row.value, '$.kpiBonus') IS NOT NULL
    )
  );
--> statement-breakpoint

-- Older installations may still keep payroll periods in the compact app_state
-- document. Clean only the same exact fields and leave all unrelated state data
-- byte-for-byte semantically equivalent.
UPDATE app_state
SET
  value_json = CASE
    WHEN json_type(value_json, '$.payrollPeriods') = 'array' THEN
      json_set(
        json_remove(value_json, '$.policies.employeeKpiRates'),
        '$.payrollPeriods',
        COALESCE(
          (
            SELECT json_group_array(json(
              CASE
                WHEN json_type(period.value, '$.rows') = 'array' THEN
                  json_set(
                    json_remove(period.value, '$.kpiSnapshot'),
                    '$.rows',
                    COALESCE(
                      (
                        SELECT json_group_array(json(json_remove(row.value, '$.kpiBonus')))
                        FROM json_each(period.value, '$.rows') AS row
                      ),
                      json('[]')
                    )
                  )
                ELSE json_remove(period.value, '$.kpiSnapshot')
              END
            ))
            FROM json_each(app_state.value_json, '$.payrollPeriods') AS period
          ),
          json('[]')
        )
      )
    ELSE json_remove(value_json, '$.policies.employeeKpiRates')
  END,
  updated_at = CURRENT_TIMESTAMP
WHERE scope_key = 'global'
  AND (
    json_type(value_json, '$.policies.employeeKpiRates') IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM json_each(value_json, '$.payrollPeriods') AS period
      WHERE json_type(period.value, '$.kpiSnapshot') IS NOT NULL
         OR (
           json_type(period.value, '$.rows') = 'array'
           AND EXISTS (
             SELECT 1
             FROM json_each(period.value, '$.rows') AS row
             WHERE json_type(row.value, '$.kpiBonus') IS NOT NULL
           )
         )
    )
  );
--> statement-breakpoint

-- Retired cached responses and audit rows are removed only when they carry an
-- exact retired key/action. This prevents stale replay without touching any
-- non-retired payroll, payment, order, attendance or finance evidence.
DELETE FROM command_receipts
WHERE instr(response_json, '"kpiSnapshot"') > 0
   OR instr(response_json, '"kpiBonus"') > 0
   OR instr(response_json, '"employee_kpi_percent_30000"') > 0
   OR instr(response_json, '"employee_kpi_percent_15000"') > 0
   OR instr(response_json, '"employee_kpi_percent_7000"') > 0;
--> statement-breakpoint

DELETE FROM audit_log
WHERE lower(entity_type) = 'kpi'
   OR lower(action) LIKE 'kpi.%';
--> statement-breakpoint

PRAGMA foreign_key_check;
--> statement-breakpoint

PRAGMA optimize;
--> statement-breakpoint
