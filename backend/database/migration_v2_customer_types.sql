-- Migration v2: Customer type segmentation + pre-orders + deposits

-- 1. Add customer_type and booking_type to bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_type  VARCHAR(20) DEFAULT 'reservation' CHECK (booking_type IN ('walkin','reservation','group')),
  ADD COLUMN IF NOT EXISTS deposit_amount    NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_status    VARCHAR(20)   DEFAULT 'pending' CHECK (deposit_status IN ('pending','paid','refunded','waived')),
  ADD COLUMN IF NOT EXISTS deposit_paid_at   TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deposit_tx_ref    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS remaining_amount  NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_paid    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contact_name      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS contact_phone     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS group_occasion    VARCHAR(200),
  ADD COLUMN IF NOT EXISTS table_number      VARCHAR(10);

-- 2. Pre-orders table (linked to booking)
CREATE TABLE IF NOT EXISTS pre_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  menu_item_id  INT  NOT NULL REFERENCES menu_items(id),
  item_name     VARCHAR(200) NOT NULL,
  unit_price    NUMERIC(10,2) NOT NULL,
  quantity      INT  NOT NULL DEFAULT 1,
  subtotal      NUMERIC(10,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pre_orders_booking ON pre_orders(booking_id);

-- 3. Group packages table
CREATE TABLE IF NOT EXISTS group_packages (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  description   TEXT,
  min_persons   INT  NOT NULL DEFAULT 6,
  price_per_head NUMERIC(10,2) NOT NULL,
  menu_items    JSONB,          -- array of menu_item_ids included
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW()
);

INSERT INTO group_packages (name, description, min_persons, price_per_head, menu_items) VALUES
  ('แพ็กเกจ A — มื้อสังสรรค์',  '4 จาน + เครื่องดื่ม ต่อท่าน',       6,  299, '[]'),
  ('แพ็กเกจ B — งานครอบครัว',   '6 จาน + ของหวาน + เครื่องดื่ม',    8,  399, '[]'),
  ('แพ็กเกจ C — อีเวนต์พรีเมียม','8 จาน + ซีฟู้ด + เครื่องดื่มไม่จำกัด', 12, 599, '[]')
ON CONFLICT DO NOTHING;

-- 4. Walk-in orders (table QR scan → order)
CREATE TABLE IF NOT EXISTS walkin_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     INT  REFERENCES members(id),
  branch_id     INT  NOT NULL REFERENCES branches(id),
  table_number  VARCHAR(10) NOT NULL,
  status        VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','preparing','served','paid','cancelled')),
  total_amount  NUMERIC(10,2) DEFAULT 0,
  paid_amount   NUMERIC(10,2) DEFAULT 0,
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT NOW(),
  paid_at       TIMESTAMP
);

CREATE TABLE IF NOT EXISTS walkin_order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  walkin_order_id UUID NOT NULL REFERENCES walkin_orders(id) ON DELETE CASCADE,
  menu_item_id    INT  NOT NULL REFERENCES menu_items(id),
  item_name       VARCHAR(200) NOT NULL,
  unit_price      NUMERIC(10,2) NOT NULL,
  quantity        INT  NOT NULL DEFAULT 1,
  subtotal        NUMERIC(10,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_walkin_orders_branch  ON walkin_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_walkin_orders_member  ON walkin_orders(member_id);
CREATE INDEX IF NOT EXISTS idx_walkin_items_order    ON walkin_order_items(walkin_order_id);

-- 5. View: booking summary with deposit info
CREATE OR REPLACE VIEW booking_summary AS
SELECT
  b.*,
  m.name          AS member_name,
  m.phone         AS member_phone,
  m.tier          AS member_tier,
  br.name         AS branch_name,
  COALESCE(SUM(po.subtotal), 0) AS pre_order_total,
  COUNT(po.id)    AS pre_order_items
FROM bookings b
LEFT JOIN members m ON m.id = b.member_id
LEFT JOIN branches br ON br.id = b.branch_id
LEFT JOIN pre_orders po ON po.booking_id = b.id
GROUP BY b.id, m.name, m.phone, m.tier, br.name;

-- v3: Staff bill verification columns
ALTER TABLE walkin_orders ADD COLUMN IF NOT EXISTS verified_by VARCHAR(100);
ALTER TABLE walkin_orders ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;

-- v3: Group quotation tracking
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS quotation_pdf_url TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS quotation_sent_at TIMESTAMP;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tax_id VARCHAR(20);
