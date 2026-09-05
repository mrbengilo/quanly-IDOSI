// Keep identity and transfer context complete: narrowing employees to their
// current store would lose historical support work and identifier collisions.
export const REVENUE_BONUS_CONTEXT_COLLECTIONS = Object.freeze([
  'stores', 'deletedStores', 'employees', 'deletedEmployees', 'supportTransfers',
])

export const REVENUE_BONUS_READ_COLLECTIONS = Object.freeze([
  ...REVENUE_BONUS_CONTEXT_COLLECTIONS,
  'orders', 'attendance', 'revenueBonusDaily', 'revenueBonusAllocations', 'revenueBonusOverrides',
])

const sqlList = (values) => values.map((value) => `'${value}'`).join(', ')
// Match the canonical bonus date fields, including legacy attendanceDate.
// Query dimensions use a different field precedence, so they cannot safely
// determine the bonus business date for every historical record.
const bonusDateSql = `substr(COALESCE(${[
  'businessDate', 'workDate', 'attendanceDate', 'date', 'effectiveDate',
  'occurredOn', 'occurredAt', 'createdAt',
].map((field) => `NULLIF(json_extract(entity.value_json, '$.${field}'), '')`).join(', ')}, ''), 1, length(params.date_key))`

export const REVENUE_BONUS_SNAPSHOT_SQL = `
  WITH params AS (SELECT ? AS scope_key, trim(?) AS store_key, ? AS date_key)
  SELECT 0 AS row_kind, app.scope_key, NULL AS collection_key, NULL AS entity_key,
    NULL AS entity_order, app.value_json, NULL AS value_bytes, NULL AS created_at,
    app.updated_at, app.updated_by, app.last_request_id, app.version
  FROM app_state AS app JOIN params ON app.scope_key = params.scope_key
  UNION ALL
  SELECT 1, collection.scope_key, collection.collection_key, NULL, NULL, NULL, NULL,
    collection.created_at, collection.updated_at, NULL, NULL, NULL
  FROM state_collections AS collection JOIN params ON collection.scope_key = params.scope_key
  WHERE collection.collection_key IN (${sqlList(REVENUE_BONUS_READ_COLLECTIONS)})
  UNION ALL
  SELECT 2, entity.scope_key, entity.collection_key, entity.entity_key, entity.entity_order,
    entity.value_json, entity.value_bytes, entity.created_at, entity.updated_at, NULL, NULL, NULL
  FROM state_entities AS entity JOIN params ON entity.scope_key = params.scope_key
  WHERE entity.collection_key IN (${sqlList(REVENUE_BONUS_READ_COLLECTIONS)})
    AND (
      entity.collection_key IN (${sqlList(REVENUE_BONUS_CONTEXT_COLLECTIONS)})
      -- Old allocation rows can identify their day only by revenueBonusDailyId.
      OR entity.collection_key = 'revenueBonusAllocations'
      OR (
        (trim(entity.store_id) = params.store_key COLLATE NOCASE OR entity.store_id IS NULL)
        AND (
          entity.collection_key NOT IN ('orders', 'attendance')
          OR ${bonusDateSql} = params.date_key
        )
      )
    )
  ORDER BY row_kind, collection_key, entity_order, entity_key
`
