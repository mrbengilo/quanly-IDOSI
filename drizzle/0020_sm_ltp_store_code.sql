-- Keep the original id because existing records use it as their store reference.
INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
SELECT
  'migration:0020:sm-ltp-store-code',
  json_object('entityKey', target.entity_key, 'storeId', 'DOSII-LTP', 'code', 'SM-LTP'),
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM state_entities AS target
WHERE target.scope_key = 'global' AND target.collection_key = 'stores'
  AND upper(trim(json_extract(target.value_json, '$.id'))) = 'DOSII-LTP'
  AND upper(trim(json_extract(target.value_json, '$.name'))) = 'SM LTP'
  AND coalesce(json_extract(target.value_json, '$.deletedAt'), '') = ''
  AND upper(trim(coalesce(json_extract(target.value_json, '$.code'), ''))) IN ('', 'DOSII-LTP', 'SM-LTP')
  AND NOT EXISTS (
    SELECT 1 FROM state_entities AS other
    WHERE other.scope_key = 'global' AND other.collection_key IN ('stores', 'deletedStores')
      AND (other.collection_key <> target.collection_key OR other.entity_key <> target.entity_key)
      AND (
        upper(trim(json_extract(other.value_json, '$.id'))) IN ('DOSII-LTP', 'SM-LTP')
        OR upper(trim(json_extract(other.value_json, '$.code'))) = 'SM-LTP'
      )
  );
--> statement-breakpoint

UPDATE state_entities
SET value_json = json_set(value_json, '$.code', 'SM-LTP', '$.storeBrand', 'SM'),
    value_bytes = length(CAST(json_set(value_json, '$.code', 'SM-LTP', '$.storeBrand', 'SM') AS BLOB)),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE scope_key = 'global' AND collection_key = 'stores'
  AND entity_key = (
    SELECT json_extract(value_json, '$.entityKey') FROM system_metadata
    WHERE meta_key = 'migration:0020:sm-ltp-store-code'
  );
--> statement-breakpoint

UPDATE app_state
SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    last_request_id = 'migration:0020:sm-ltp-store-code'
WHERE scope_key = 'global'
  AND EXISTS (SELECT 1 FROM system_metadata WHERE meta_key = 'migration:0020:sm-ltp-store-code');
