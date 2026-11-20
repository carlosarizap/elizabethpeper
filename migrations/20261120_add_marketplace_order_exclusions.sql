CREATE TABLE IF NOT EXISTS marketplace_order_exclusion (
  marketplace TEXT NOT NULL,
  order_id TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (marketplace, order_id)
);

