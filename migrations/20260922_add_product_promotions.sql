CREATE TABLE IF NOT EXISTS product_promotion_campaign (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(120) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  discount_percent NUMERIC(6, 3) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'planned',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_promotion_campaign_dates_check CHECK (ends_at > starts_at),
  CONSTRAINT product_promotion_campaign_discount_check
    CHECK (discount_percent > 0 AND discount_percent < 100)
);

CREATE TABLE IF NOT EXISTS product_promotion_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL
    REFERENCES product_promotion_campaign(id) ON DELETE CASCADE,
  marketplace VARCHAR(50) NOT NULL,
  external_product_id VARCHAR(255) NOT NULL,
  external_variant_id VARCHAR(255) NOT NULL,
  seller_sku VARCHAR(255),
  title TEXT NOT NULL,
  regular_price NUMERIC(14, 2),
  previous_price NUMERIC(14, 2),
  previous_compare_at_price NUMERIC(14, 2),
  promotion_price NUMERIC(14, 2),
  status VARCHAR(30) NOT NULL DEFAULT 'planned',
  external_promotion_id VARCHAR(255),
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_at TIMESTAMPTZ,
  restored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, marketplace, external_variant_id)
);

CREATE INDEX IF NOT EXISTS product_promotion_item_status_idx
ON product_promotion_item (campaign_id, marketplace, status);

CREATE INDEX IF NOT EXISTS product_promotion_item_due_idx
ON product_promotion_item (status, campaign_id);
