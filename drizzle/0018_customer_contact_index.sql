-- Read model only. Orders remain the canonical source; every direct write,
-- soft delete, restore, import and cascade updates this projection atomically.
CREATE TABLE customer_order_contacts (
  scope_key TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  entity_order INTEGER NOT NULL,
  contact_json TEXT NOT NULL CHECK (json_valid(contact_json)),
  PRIMARY KEY (scope_key, entity_key)
) STRICT;
--> statement-breakpoint

CREATE TABLE customer_contact_revisions (
  scope_key TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL
) STRICT;
--> statement-breakpoint

CREATE VIEW customer_order_contact_source AS
SELECT scope_key, entity_key, entity_order, json_object(
  'id', json_extract(value_json, '$.id'), 'code', json_extract(value_json, '$.code'),
  'storeId', store_id, 'storeName', json_extract(value_json, '$.storeName'),
  'customerName', json_extract(value_json, '$.customerName'),
  'customerPhone', json_extract(value_json, '$.customerPhone'),
  'createdAt', json_extract(value_json, '$.createdAt'),
  'date', json_extract(value_json, '$.date'),
  'businessDate', json_extract(value_json, '$.businessDate'),
  'deletedAt', json_extract(value_json, '$.deletedAt'),
  'status', json_extract(value_json, '$.status'),
  'source', json_extract(value_json, '$.source')
) AS contact_json
FROM state_entities WHERE collection_key = 'orders';
--> statement-breakpoint

INSERT INTO customer_order_contacts SELECT * FROM customer_order_contact_source;
--> statement-breakpoint
INSERT INTO customer_contact_revisions SELECT scope_key, 1 FROM app_state;
--> statement-breakpoint

CREATE TRIGGER customer_contacts_insert AFTER INSERT ON state_entities
WHEN NEW.collection_key = 'orders'
BEGIN
  INSERT OR REPLACE INTO customer_order_contacts
    SELECT * FROM customer_order_contact_source
    WHERE scope_key = NEW.scope_key AND entity_key = NEW.entity_key;
  INSERT INTO customer_contact_revisions VALUES (NEW.scope_key, 1)
    ON CONFLICT(scope_key) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint

CREATE TRIGGER customer_contacts_delete AFTER DELETE ON state_entities
WHEN OLD.collection_key = 'orders'
BEGIN
  DELETE FROM customer_order_contacts
    WHERE scope_key = OLD.scope_key AND entity_key = OLD.entity_key;
  INSERT INTO customer_contact_revisions VALUES (OLD.scope_key, 1)
    ON CONFLICT(scope_key) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint

CREATE TRIGGER customer_contacts_update AFTER UPDATE ON state_entities
WHEN OLD.collection_key = 'orders' OR NEW.collection_key = 'orders'
BEGIN
  DELETE FROM customer_order_contacts
    WHERE OLD.collection_key = 'orders'
      AND scope_key = OLD.scope_key AND entity_key = OLD.entity_key;
  INSERT OR REPLACE INTO customer_order_contacts
    SELECT * FROM customer_order_contact_source
    WHERE NEW.collection_key = 'orders'
      AND scope_key = NEW.scope_key AND entity_key = NEW.entity_key;
  INSERT INTO customer_contact_revisions
    SELECT OLD.scope_key, 1 WHERE OLD.collection_key = 'orders'
    ON CONFLICT(scope_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO customer_contact_revisions
    SELECT NEW.scope_key, 1 WHERE NEW.collection_key = 'orders'
      AND (OLD.collection_key <> 'orders' OR OLD.scope_key <> NEW.scope_key)
    ON CONFLICT(scope_key) DO UPDATE SET revision = revision + 1;
END;
