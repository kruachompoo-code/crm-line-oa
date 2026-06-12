-- ═══════════════════════════════════════════════════════════
--  CRM LINE OA — PostgreSQL Schema v1.0
-- ═══════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─── BRANCHES ──────────────────────────────────────────────
CREATE TABLE branches (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100) NOT NULL,
  address     TEXT,
  phone       VARCHAR(20),
  lat         DECIMAL(10,8),
  lng         DECIMAL(11,8),
  line_oa_id  VARCHAR(50),
  utm_code    VARCHAR(20) UNIQUE,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── MEMBERS ───────────────────────────────────────────────
CREATE TABLE members (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  line_user_id    VARCHAR(50) UNIQUE NOT NULL,
  phone           VARCHAR(20) UNIQUE,
  name            VARCHAR(100),
  display_name    VARCHAR(100),
  picture_url     TEXT,
  birthday        DATE,
  gender          VARCHAR(10),
  tier            VARCHAR(20) DEFAULT 'Silver' CHECK (tier IN ('Silver','Gold','Platinum')),
  points          INT DEFAULT 0,
  yearly_spend    DECIMAL(12,2) DEFAULT 0,
  total_visits    INT DEFAULT 0,
  last_visit_at   TIMESTAMPTZ,
  registered_at   TIMESTAMPTZ DEFAULT NOW(),
  branch_id       UUID REFERENCES branches(id),
  -- Accessibility
  accessibility_mode BOOLEAN DEFAULT FALSE,
  -- Family Account
  family_id       UUID,
  family_role     VARCHAR(20) CHECK (family_role IN ('owner','member',NULL)),
  -- Corporate
  company_name    VARCHAR(200),
  tax_id          VARCHAR(20),
  is_corporate    BOOLEAN DEFAULT FALSE,
  -- Gamification
  streak_count    INT DEFAULT 0,
  last_streak_at  DATE,
  badges          TEXT[] DEFAULT '{}',
  -- Status
  is_active       BOOLEAN DEFAULT TRUE,
  is_blocked      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_members_phone ON members(phone);
CREATE INDEX idx_members_line_user_id ON members(line_user_id);
CREATE INDEX idx_members_tier ON members(tier);
CREATE INDEX idx_members_last_visit ON members(last_visit_at);
CREATE INDEX idx_members_family ON members(family_id);

-- ─── POINTS TRANSACTIONS ───────────────────────────────────
CREATE TABLE point_transactions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type        VARCHAR(30) NOT NULL CHECK (type IN (
                'earn_purchase','earn_bonus','earn_referral','earn_survey',
                'redeem_coupon','redeem_reward','expire','adjust')),
  points      INT NOT NULL,
  balance     INT NOT NULL,
  amount_baht DECIMAL(10,2),
  description TEXT,
  ref_id      VARCHAR(100),
  branch_id   UUID REFERENCES branches(id),
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_pt_member ON point_transactions(member_id);
CREATE INDEX idx_pt_created ON point_transactions(created_at);
CREATE INDEX idx_pt_expire ON point_transactions(expires_at) WHERE expires_at IS NOT NULL;

-- ─── TIERS HISTORY ─────────────────────────────────────────
CREATE TABLE tier_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID NOT NULL REFERENCES members(id),
  from_tier   VARCHAR(20),
  to_tier     VARCHAR(20),
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── COUPONS ───────────────────────────────────────────────
CREATE TABLE coupons (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code          VARCHAR(20) UNIQUE NOT NULL,
  name          VARCHAR(200) NOT NULL,
  description   TEXT,
  type          VARCHAR(30) CHECK (type IN ('discount_baht','discount_percent','free_item','points_multiplier')),
  value         DECIMAL(10,2) NOT NULL,
  min_spend     DECIMAL(10,2) DEFAULT 0,
  max_discount  DECIMAL(10,2),
  -- Eligibility
  tier_required VARCHAR(20) CHECK (tier_required IN ('Silver','Gold','Platinum',NULL)),
  campaign_id   UUID,
  -- Usage limits
  total_issued  INT DEFAULT 0,
  total_redeemed INT DEFAULT 0,
  max_per_member INT DEFAULT 1,
  -- Validity
  valid_from    TIMESTAMPTZ NOT NULL,
  valid_until   TIMESTAMPTZ NOT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── MEMBER COUPONS ────────────────────────────────────────
CREATE TABLE member_coupons (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID NOT NULL REFERENCES members(id),
  coupon_id   UUID NOT NULL REFERENCES coupons(id),
  status      VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','used','expired')),
  issued_at   TIMESTAMPTZ DEFAULT NOW(),
  used_at     TIMESTAMPTZ,
  branch_id   UUID REFERENCES branches(id),
  UNIQUE(member_id, coupon_id)
);
CREATE INDEX idx_mc_member ON member_coupons(member_id, status);

-- ─── BOOKINGS ──────────────────────────────────────────────
CREATE TABLE bookings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id       UUID REFERENCES members(id),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  name            VARCHAR(100) NOT NULL,
  phone           VARCHAR(20) NOT NULL,
  party_size      INT NOT NULL,
  booking_date    DATE NOT NULL,
  booking_time    TIME NOT NULL,
  special_request TEXT,
  table_no        VARCHAR(10),
  -- Special needs
  needs_highchair BOOLEAN DEFAULT FALSE,
  needs_private   BOOLEAN DEFAULT FALSE,
  -- Status
  status          VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','arrived','no_show','cancelled')),
  reminder_sent   BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_bookings_date ON bookings(booking_date, branch_id);
CREATE INDEX idx_bookings_member ON bookings(member_id);

-- ─── ORDERS (In-LINE Ordering) ─────────────────────────────
CREATE TABLE orders (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id     UUID REFERENCES members(id),
  branch_id     UUID NOT NULL REFERENCES branches(id),
  order_no      VARCHAR(20) UNIQUE NOT NULL,
  type          VARCHAR(20) CHECK (type IN ('dine_in','takeaway','delivery')),
  status        VARCHAR(30) DEFAULT 'pending' CHECK (status IN (
                  'pending','confirmed','preparing','ready','delivered','cancelled')),
  items         JSONB NOT NULL DEFAULT '[]',
  subtotal      DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount      DECIMAL(10,2) DEFAULT 0,
  total         DECIMAL(10,2) NOT NULL DEFAULT 0,
  coupon_id     UUID REFERENCES coupons(id),
  payment_method VARCHAR(30),
  payment_status VARCHAR(20) DEFAULT 'pending',
  line_pay_txn  VARCHAR(100),
  address       TEXT,
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_orders_member ON orders(member_id);
CREATE INDEX idx_orders_branch ON orders(branch_id, created_at);

-- ─── MENU ITEMS ────────────────────────────────────────────
CREATE TABLE menu_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id     UUID REFERENCES branches(id),
  category      VARCHAR(50),
  name          VARCHAR(200) NOT NULL,
  name_en       VARCHAR(200),
  description   TEXT,
  price         DECIMAL(10,2) NOT NULL,
  image_url     TEXT,
  allergens     TEXT[] DEFAULT '{}',
  calories      INT,
  is_available  BOOLEAN DEFAULT TRUE,
  is_member_only BOOLEAN DEFAULT FALSE,
  sort_order    INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── CAMPAIGNS ─────────────────────────────────────────────
CREATE TABLE campaigns (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(200) NOT NULL,
  type          VARCHAR(50) CHECK (type IN (
                  'broadcast','segment','birthday','reengagement',
                  'welcome','tier_upgrade','streak','referral')),
  status        VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','scheduled','running','paused','completed')),
  -- Targeting
  target_segment VARCHAR(50),
  target_tier   VARCHAR(20),
  target_branch UUID REFERENCES branches(id),
  -- Schedule
  scheduled_at  TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  -- Message
  message_type  VARCHAR(30),
  message_body  JSONB,
  -- Frequency control
  max_per_member INT DEFAULT 1,
  -- Stats
  total_sent    INT DEFAULT 0,
  total_opened  INT DEFAULT 0,
  total_clicked INT DEFAULT 0,
  total_converted INT DEFAULT 0,
  -- UTM
  utm_source    VARCHAR(50) DEFAULT 'line_oa',
  utm_medium    VARCHAR(50) DEFAULT 'crm',
  utm_campaign  VARCHAR(100),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── CAMPAIGN LOGS ─────────────────────────────────────────
CREATE TABLE campaign_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id),
  member_id   UUID NOT NULL REFERENCES members(id),
  status      VARCHAR(20) CHECK (status IN ('sent','opened','clicked','converted','failed')),
  sent_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, member_id)
);
CREATE INDEX idx_cl_campaign ON campaign_logs(campaign_id);
CREATE INDEX idx_cl_member ON campaign_logs(member_id);

-- ─── MESSAGE FREQUENCY ─────────────────────────────────────
CREATE TABLE message_frequency (
  member_id   UUID NOT NULL REFERENCES members(id),
  week_start  DATE NOT NULL,
  count       INT DEFAULT 0,
  PRIMARY KEY(member_id, week_start)
);

-- ─── NOTIFICATION PREFERENCES ──────────────────────────────
CREATE TABLE notification_prefs (
  member_id       UUID PRIMARY KEY REFERENCES members(id),
  allow_promotion BOOLEAN DEFAULT TRUE,
  allow_birthday  BOOLEAN DEFAULT TRUE,
  allow_points    BOOLEAN DEFAULT TRUE,
  allow_booking   BOOLEAN DEFAULT TRUE,
  quiet_start     TIME DEFAULT '22:00',
  quiet_end       TIME DEFAULT '08:00',
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PDPA CONSENTS ─────────────────────────────────────────
CREATE TABLE pdpa_consents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID NOT NULL REFERENCES members(id),
  type        VARCHAR(50) CHECK (type IN ('marketing','analytics','personalization','third_party')),
  consented   BOOLEAN NOT NULL,
  version     VARCHAR(10) DEFAULT '1.0',
  ip_address  VARCHAR(45),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_pdpa_member ON pdpa_consents(member_id);

-- ─── CHAT SESSIONS (Human Handoff) ────────────────────────
CREATE TABLE chat_sessions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id     UUID REFERENCES members(id),
  line_user_id  VARCHAR(50) NOT NULL,
  mode          VARCHAR(20) DEFAULT 'bot' CHECK (mode IN ('bot','human','closed')),
  staff_id      VARCHAR(50),
  issue_type    VARCHAR(50),
  resolved      BOOLEAN DEFAULT FALSE,
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ
);
CREATE INDEX idx_cs_line_user ON chat_sessions(line_user_id, mode);

-- ─── QR CODES (UTM Tracking) ───────────────────────────────
CREATE TABLE qr_codes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id   UUID REFERENCES branches(id),
  label       VARCHAR(100),
  location    VARCHAR(100),
  utm_source  VARCHAR(50) DEFAULT 'qr',
  utm_medium  VARCHAR(50),
  utm_campaign VARCHAR(100),
  url         TEXT NOT NULL,
  scan_count  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── GAMIFICATION BADGES ───────────────────────────────────
CREATE TABLE badges (
  id          VARCHAR(50) PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  icon        VARCHAR(10),
  condition   JSONB,
  points_reward INT DEFAULT 0
);

INSERT INTO badges VALUES
  ('first_visit',   'First Timer',     'มาครั้งแรก',              '🌟', '{"type":"visits","count":1}',    50),
  ('streak_3',      'Hat Trick',       'มา 3 ครั้งติดกัน',         '🎯', '{"type":"streak","count":3}',   100),
  ('streak_5',      'Loyal 5',         'มา 5 ครั้งติดกัน',         '🔥', '{"type":"streak","count":5}',   200),
  ('streak_10',     'Dedicated',       'มา 10 ครั้งติดกัน',        '👑', '{"type":"streak","count":10}',  500),
  ('big_spender',   'Big Spender',     'ใช้จ่ายรวม 5,000 บาท',    '💰', '{"type":"spend","amount":5000}',200),
  ('referral_1',    'Connector',       'ชวนเพื่อนสำเร็จ 1 คน',    '🤝', '{"type":"referral","count":1}',  150),
  ('birthday_used', 'Birthday Star',   'ใช้คูปองวันเกิด',          '🎂', '{"type":"birthday_coupon"}',     100),
  ('reviewer',      'Food Critic',     'รีวิวอาหาร 3 ครั้ง',       '⭐', '{"type":"review","count":3}',   100);

-- ─── REFERRALS ─────────────────────────────────────────────
CREATE TABLE referrals (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id   UUID NOT NULL REFERENCES members(id),
  referred_id   UUID NOT NULL REFERENCES members(id),
  status        VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','qualified','rewarded')),
  reward_points INT DEFAULT 100,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referred_id)
);

-- ─── FAMILY ACCOUNTS ───────────────────────────────────────
CREATE TABLE family_groups (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100),
  owner_id    UUID NOT NULL REFERENCES members(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── REVIEWS / RATINGS ─────────────────────────────────────
CREATE TABLE reviews (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID NOT NULL REFERENCES members(id),
  branch_id   UUID REFERENCES branches(id),
  order_id    UUID REFERENCES orders(id),
  rating      INT CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── OFFLINE QR TICKETS (Fallback) ─────────────────────────
CREATE TABLE offline_tickets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_code VARCHAR(20) UNIQUE NOT NULL,
  branch_id   UUID REFERENCES branches(id),
  amount_baht DECIMAL(10,2),
  status      VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','claimed','expired')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
  claimed_by  UUID REFERENCES members(id),
  claimed_at  TIMESTAMPTZ
);

-- ─── VIEWS ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW member_rfm AS
SELECT
  m.id,
  m.line_user_id,
  m.name,
  m.tier,
  m.points,
  EXTRACT(DAY FROM NOW() - m.last_visit_at)::INT AS recency_days,
  m.total_visits AS frequency,
  m.yearly_spend AS monetary,
  CASE
    WHEN EXTRACT(DAY FROM NOW() - m.last_visit_at) <= 7
         AND m.total_visits >= 8 AND m.yearly_spend >= 5000 THEN 'VIP'
    WHEN EXTRACT(DAY FROM NOW() - m.last_visit_at) <= 14
         AND m.total_visits >= 4 THEN 'Loyal'
    WHEN EXTRACT(DAY FROM NOW() - m.last_visit_at) BETWEEN 31 AND 90 THEN 'At-Risk'
    WHEN EXTRACT(DAY FROM NOW() - m.last_visit_at) > 90 THEN 'Lost'
    ELSE 'New'
  END AS rfm_segment
FROM members m
WHERE m.is_active = TRUE;

-- ─── SEED: Default Branch ──────────────────────────────────
INSERT INTO branches (name, utm_code, line_oa_id)
VALUES ('สาขาหลัก', 'MAIN01', 'YOUR_LINE_OA_ID');

