ALTER TABLE order_detail
ADD COLUMN IF NOT EXISTS marketplace_order_id VARCHAR(255);

DROP INDEX IF EXISTS order_detail_marketplace_item_unique;

CREATE UNIQUE INDEX IF NOT EXISTS order_detail_marketplace_item_without_order_unique
ON order_detail (id_order_header, marketplace_item_id)
WHERE marketplace_item_id IS NOT NULL
  AND marketplace_order_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS order_detail_marketplace_order_item_unique
ON order_detail (id_order_header, marketplace_order_id, marketplace_item_id)
WHERE marketplace_order_id IS NOT NULL
  AND marketplace_item_id IS NOT NULL;
