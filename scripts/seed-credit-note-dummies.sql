BEGIN;

-- Permite volver a ejecutar este seed sin duplicar datos.
DELETE FROM order_detail
WHERE id_order_header IN (
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid
);

DELETE FROM order_header
WHERE id IN (
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid
);

-- Caso 1: devoluciÃ³n total. generateCreditNotes() lo seleccionarÃ¡ primero.
INSERT INTO order_header (
  id,
  order_id,
  total_amount,
  shipping_amount,
  document_type,
  has_invoice,
  invoice_uploaded,
  marketplace,
  status,
  return_status,
  return_updated_at,
  sii_folio,
  sii_issued_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'DUMMY-NC-TOTAL-9641',
  11990,
  0,
  'boleta',
  true,
  false,
  'dummy',
  'devuelto',
  'devolucion_total',
  NOW(),
  9641,
  DATE '2026-08-12'
);

INSERT INTO order_detail (
  id_order_header,
  marketplace_item_id,
  product_title,
  product_quantity,
  product_price,
  status,
  marketplace_status,
  status_updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'DUMMY-NC-TOTAL-ITEM-1',
  'CojÃ­n dummy devoluciÃ³n total',
  1,
  11990,
  'devuelto',
  'returned',
  NOW()
);

-- Caso 2: devoluciÃ³n parcial. Solo la primera lÃ­nea entrarÃ¡ en la NC.
INSERT INTO order_header (
  id,
  order_id,
  total_amount,
  shipping_amount,
  document_type,
  has_invoice,
  invoice_uploaded,
  marketplace,
  status,
  return_status,
  return_updated_at,
  sii_folio,
  sii_issued_at
) VALUES (
  '00000000-0000-0000-0000-000000000002',
  'DUMMY-NC-PARCIAL-9641',
  19980,
  0,
  'boleta',
  true,
  false,
  'dummy',
  'devuelto',
  'devolucion_parcial',
  NOW(),
  9641,
  DATE '2026-08-12'
);

INSERT INTO order_detail (
  id_order_header,
  marketplace_item_id,
  product_title,
  product_quantity,
  product_price,
  status,
  marketplace_status,
  status_updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000002',
    'DUMMY-NC-PARCIAL-ITEM-1',
    'Funda dummy devuelta',
    1,
    7990,
    'devuelto',
    'returned',
    NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'DUMMY-NC-PARCIAL-ITEM-2',
    'Relleno dummy conservado',
    1,
    11990,
    'recibido',
    'delivered',
    NOW()
  );

COMMIT;
