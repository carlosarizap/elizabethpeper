CREATE SEQUENCE IF NOT EXISTS quotation_sequence START WITH 254;

CREATE TABLE IF NOT EXISTS quotation_customer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  rut VARCHAR(30),
  contact_name TEXT,
  email TEXT,
  phone VARCHAR(80),
  address TEXT,
  city VARCHAR(120),
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS quotation_customer_normalized_name_idx
ON quotation_customer (normalized_name);

CREATE UNIQUE INDEX IF NOT EXISTS quotation_customer_rut_idx
ON quotation_customer (UPPER(rut))
WHERE rut IS NOT NULL AND TRIM(rut) <> '';

CREATE TABLE IF NOT EXISTS quotation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_number BIGINT NOT NULL DEFAULT nextval('quotation_sequence'),
  number_prefix VARCHAR(30) NOT NULL DEFAULT '22023',
  quote_number VARCHAR(80) GENERATED ALWAYS AS
    (number_prefix || '-' || sequence_number::text) STORED,
  customer_id UUID NOT NULL REFERENCES quotation_customer(id),
  quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  delivery_date DATE,
  delivery_note TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  currency VARCHAR(3) NOT NULL DEFAULT 'CLP',
  prices_include_vat BOOLEAN NOT NULL DEFAULT FALSE,
  vat_rate NUMERIC(7, 6) NOT NULL DEFAULT 0.19,
  discount_type VARCHAR(20) NOT NULL DEFAULT 'none',
  discount_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  payment_terms TEXT,
  notes TEXT,
  subtotal_amount NUMERIC(16, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(16, 2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(16, 2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(16, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(16, 2) NOT NULL DEFAULT 0,
  sent_at TIMESTAMP,
  accepted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT quotation_number_unique UNIQUE (quote_number),
  CONSTRAINT quotation_status_check
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled')),
  CONSTRAINT quotation_currency_check CHECK (currency = 'CLP'),
  CONSTRAINT quotation_vat_rate_check CHECK (vat_rate >= 0 AND vat_rate <= 1),
  CONSTRAINT quotation_discount_type_check CHECK (discount_type IN ('none', 'percent', 'fixed')),
  CONSTRAINT quotation_discount_value_check CHECK (discount_value >= 0)
);

CREATE INDEX IF NOT EXISTS quotation_customer_idx
ON quotation (customer_id, quote_date DESC);

CREATE INDEX IF NOT EXISTS quotation_status_idx
ON quotation (status, quote_date DESC);

CREATE TABLE IF NOT EXISTS quotation_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  catalog_product_id UUID REFERENCES catalog_product(id) ON DELETE SET NULL,
  catalog_variant_id UUID REFERENCES catalog_variant(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL,
  unit VARCHAR(40) NOT NULL DEFAULT 'unidad',
  unit_price NUMERIC(16, 2) NOT NULL,
  line_total NUMERIC(18, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT quotation_item_quantity_check CHECK (quantity > 0),
  CONSTRAINT quotation_item_unit_price_check CHECK (unit_price >= 0),
  CONSTRAINT quotation_item_order_unique UNIQUE (quotation_id, sort_order)
);

CREATE INDEX IF NOT EXISTS quotation_item_quotation_idx
ON quotation_item (quotation_id, sort_order);

CREATE INDEX IF NOT EXISTS quotation_item_catalog_variant_idx
ON quotation_item (catalog_variant_id)
WHERE catalog_variant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS quotation_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  note TEXT,
  changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT quotation_status_history_to_check
    CHECK (to_status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS quotation_status_history_quotation_idx
ON quotation_status_history (quotation_id, changed_at DESC);

