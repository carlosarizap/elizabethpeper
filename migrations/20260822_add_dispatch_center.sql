CREATE TABLE IF NOT EXISTS marketplace_shipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_order_header UUID NOT NULL REFERENCES order_header(id) ON DELETE CASCADE,
  marketplace VARCHAR(50) NOT NULL,
  external_shipment_id VARCHAR(255) NOT NULL,
  external_order_id VARCHAR(255),
  status VARCHAR(100),
  substatus VARCHAR(100),
  shipping_mode VARCHAR(100),
  logistic_type VARCHAR(100),
  tracking_number VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (marketplace, external_shipment_id)
);

CREATE INDEX IF NOT EXISTS marketplace_shipment_order_header_idx
ON marketplace_shipment (id_order_header);

CREATE INDEX IF NOT EXISTS marketplace_shipment_operational_status_idx
ON marketplace_shipment (marketplace, status, substatus);

CREATE TABLE IF NOT EXISTS dispatch_batch (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_request_id UUID NOT NULL UNIQUE,
  marketplace VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'processing',
  page_size VARCHAR(20) NOT NULL DEFAULT 'letter',
  document_pdf BYTEA,
  document_mime_type VARCHAR(100),
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  error_message TEXT,
  CONSTRAINT dispatch_batch_status_check
    CHECK (status IN ('processing', 'completed', 'partial', 'failed'))
);

CREATE INDEX IF NOT EXISTS dispatch_batch_requested_at_idx
ON dispatch_batch (requested_at DESC);

CREATE TABLE IF NOT EXISTS dispatch_batch_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_batch_id UUID NOT NULL REFERENCES dispatch_batch(id) ON DELETE CASCADE,
  id_order_header UUID NOT NULL REFERENCES order_header(id) ON DELETE CASCADE,
  marketplace_shipment_id UUID REFERENCES marketplace_shipment(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL,
  print_requested_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT dispatch_batch_item_status_check
    CHECK (status IN ('completed', 'failed')),
  UNIQUE (dispatch_batch_id, marketplace_shipment_id)
);

CREATE INDEX IF NOT EXISTS dispatch_batch_item_order_header_idx
ON dispatch_batch_item (id_order_header, print_requested_at DESC);
