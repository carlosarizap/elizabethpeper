ALTER TABLE order_detail
ADD COLUMN IF NOT EXISTS marketplace_item_id VARCHAR(255);

ALTER TABLE order_detail
ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'pendiente';

ALTER TABLE order_detail
ADD COLUMN IF NOT EXISTS marketplace_status VARCHAR(100);

ALTER TABLE order_detail
ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMP;

ALTER TABLE order_header
ADD COLUMN IF NOT EXISTS return_status VARCHAR(30) DEFAULT 'sin_devolucion';

ALTER TABLE order_header
ADD COLUMN IF NOT EXISTS return_updated_at TIMESTAMP;

UPDATE order_detail SET status = 'pendiente' WHERE status IS NULL;
UPDATE order_header SET return_status = 'sin_devolucion' WHERE return_status IS NULL;
UPDATE order_detail
SET status = 'pendiente'
WHERE status NOT IN ('pendiente', 'enviado', 'recibido', 'cancelado', 'devuelto');
UPDATE order_header
SET return_status = 'sin_devolucion'
WHERE return_status NOT IN ('sin_devolucion', 'devolucion_parcial', 'devolucion_total');

CREATE UNIQUE INDEX IF NOT EXISTS order_detail_marketplace_item_unique
ON order_detail (id_order_header, marketplace_item_id)
WHERE marketplace_item_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_detail_status_check'
  ) THEN
    ALTER TABLE order_detail
    ADD CONSTRAINT order_detail_status_check
    CHECK (status IN ('pendiente', 'enviado', 'recibido', 'cancelado', 'devuelto'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_header_return_status_check'
  ) THEN
    ALTER TABLE order_header
    ADD CONSTRAINT order_header_return_status_check
    CHECK (return_status IN ('sin_devolucion', 'devolucion_parcial', 'devolucion_total'));
  END IF;
END $$;
