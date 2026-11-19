CREATE TABLE IF NOT EXISTS walmart_dispatch_label (
  purchase_order_id TEXT NOT NULL,
  package_key TEXT NOT NULL,
  request_payload JSONB NOT NULL,
  product_summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'creating', 'ready', 'failed', 'uncertain')),
  tracking_number TEXT,
  document_pdf BYTEA,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (purchase_order_id, package_key)
);
