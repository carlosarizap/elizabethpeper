ALTER TABLE order_header
ADD COLUMN IF NOT EXISTS delivery_date_source VARCHAR(20);

UPDATE order_header
SET delivery_date_source = 'sla'
WHERE marketplace = 'mercado_libre'
  AND delivery_date IS NOT NULL
  AND delivery_date_source IS NULL;
