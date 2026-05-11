-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── PROFILES ───────────────────────────────────────────────────────────────
CREATE TABLE profiles (
  id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name           text,
  role                text NOT NULL DEFAULT 'hedger'
                        CHECK (role IN ('hedger','provider','admin','both')),
  preferred_currency  text NOT NULL DEFAULT 'USD'
                        CHECK (preferred_currency IN ('USD','MXN')),
  stripe_customer_id  text,
  conekta_customer_id text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── CATEGORIES ─────────────────────────────────────────────────────────────
CREATE TABLE categories (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          text NOT NULL CHECK (name IN ('Urban','Nature','Experiences','Events')),
  slug          text NOT NULL UNIQUE,
  color         text NOT NULL,
  icon_url      text,
  display_order int  NOT NULL DEFAULT 0
);

-- ─── CONTRACTS ──────────────────────────────────────────────────────────────
CREATE TABLE contracts (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug             text NOT NULL UNIQUE,
  title            text NOT NULL,
  description      text,
  category_id      uuid NOT NULL REFERENCES categories(id),
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','settled','cancelled','pending')),
  trigger_type     text NOT NULL
                     CHECK (trigger_type IN ('weather','urban','event','manual')),
  trigger_condition jsonb NOT NULL DEFAULT '{}',
  trigger_deadline  timestamptz NOT NULL,
  location          jsonb NOT NULL DEFAULT '{}',
  icon_url          text,
  total_volume_usd  numeric NOT NULL DEFAULT 0,
  total_volume_mxn  numeric NOT NULL DEFAULT 0,
  is_featured       boolean NOT NULL DEFAULT false,
  settled_outcome   boolean,
  created_by        uuid NOT NULL REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  settled_at        timestamptz
);

-- ─── COVERAGE TIERS ─────────────────────────────────────────────────────────
CREATE TABLE coverage_tiers (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id          uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  name                 text NOT NULL CHECK (name IN ('basic','premium')),
  premium_usd          numeric NOT NULL DEFAULT 0,
  payout_usd           numeric NOT NULL DEFAULT 0,
  premium_mxn          numeric NOT NULL DEFAULT 0,
  payout_mxn           numeric NOT NULL DEFAULT 0,
  max_capacity_usd     numeric NOT NULL DEFAULT 100000,
  current_capacity_usd numeric NOT NULL DEFAULT 0,
  base_probability     numeric NOT NULL DEFAULT 0.5
                         CHECK (base_probability >= 0 AND base_probability <= 1),
  last_priced_at       timestamptz,
  pricing_inputs       jsonb
);

-- ─── HEDGER POSITIONS ───────────────────────────────────────────────────────
CREATE TABLE hedger_positions (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            uuid NOT NULL REFERENCES profiles(id),
  contract_id        uuid NOT NULL REFERENCES contracts(id),
  tier_id            uuid NOT NULL REFERENCES coverage_tiers(id),
  premium_paid_usd   numeric NOT NULL DEFAULT 0,
  payout_amount_usd  numeric NOT NULL DEFAULT 0,
  premium_paid_mxn   numeric NOT NULL DEFAULT 0,
  payout_amount_mxn  numeric NOT NULL DEFAULT 0,
  currency           text NOT NULL CHECK (currency IN ('USD','MXN')),
  payment_provider   text NOT NULL CHECK (payment_provider IN ('stripe','conekta')),
  payment_intent_id  text,
  status             text NOT NULL DEFAULT 'pending_payment'
                       CHECK (status IN ('pending_payment','active','paid_out','expired','cancelled')),
  purchased_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL
);

-- ─── PROVIDER POSITIONS ─────────────────────────────────────────────────────
CREATE TABLE provider_positions (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               uuid NOT NULL REFERENCES profiles(id),
  contract_id           uuid NOT NULL REFERENCES contracts(id),
  tier_id               uuid NOT NULL REFERENCES coverage_tiers(id),
  capital_deposited_usd numeric NOT NULL DEFAULT 0,
  capital_deposited_mxn numeric NOT NULL DEFAULT 0,
  currency              text NOT NULL CHECK (currency IN ('USD','MXN')),
  payment_provider      text NOT NULL CHECK (payment_provider IN ('stripe','conekta')),
  payment_intent_id     text,
  expected_return_usd   numeric NOT NULL DEFAULT 0,
  actual_return_usd     numeric,
  expected_return_mxn   numeric NOT NULL DEFAULT 0,
  actual_return_mxn     numeric,
  status                text NOT NULL DEFAULT 'pending_payment'
                           CHECK (status IN ('pending_payment','active','settled','cancelled')),
  deposited_at          timestamptz NOT NULL DEFAULT now(),
  settled_at            timestamptz
);

-- ─── ORACLE READINGS ────────────────────────────────────────────────────────
CREATE TABLE oracle_readings (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id  uuid NOT NULL REFERENCES contracts(id),
  source       text NOT NULL CHECK (source IN ('openweathermap','tomorrow_io','waze','manual')),
  reading_type text NOT NULL,
  value        jsonb NOT NULL DEFAULT '{}',
  trigger_met  boolean NOT NULL DEFAULT false,
  read_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── PAYOUTS ────────────────────────────────────────────────────────────────
CREATE TABLE payouts (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id         uuid NOT NULL REFERENCES contracts(id),
  hedger_position_id  uuid NOT NULL REFERENCES hedger_positions(id),
  amount_usd          numeric NOT NULL DEFAULT 0,
  amount_mxn          numeric NOT NULL DEFAULT 0,
  currency            text NOT NULL CHECK (currency IN ('USD','MXN')),
  payment_provider    text NOT NULL CHECK (payment_provider IN ('stripe','conekta')),
  transfer_id         text,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','completed','failed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);

-- ─── PRICING HISTORY ────────────────────────────────────────────────────────
CREATE TABLE pricing_history (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id         uuid NOT NULL REFERENCES contracts(id),
  tier_id             uuid NOT NULL REFERENCES coverage_tiers(id),
  bs_inputs           jsonb NOT NULL DEFAULT '{}',
  bs_output           jsonb NOT NULL DEFAULT '{}',
  premium_usd_before  numeric NOT NULL DEFAULT 0,
  premium_usd_after   numeric NOT NULL DEFAULT 0,
  calculated_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── INDEXES ────────────────────────────────────────────────────────────────
CREATE INDEX idx_contracts_category  ON contracts(category_id);
CREATE INDEX idx_contracts_status    ON contracts(status);
CREATE INDEX idx_contracts_slug      ON contracts(slug);
CREATE INDEX idx_tiers_contract      ON coverage_tiers(contract_id);
CREATE INDEX idx_hedger_user         ON hedger_positions(user_id);
CREATE INDEX idx_hedger_contract     ON hedger_positions(contract_id);
CREATE INDEX idx_provider_user       ON provider_positions(user_id);
CREATE INDEX idx_oracle_contract     ON oracle_readings(contract_id);
CREATE INDEX idx_payouts_position    ON payouts(hedger_position_id);

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────────────────────
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_tiers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hedger_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oracle_readings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_history  ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Own profile select" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Own profile update" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Own profile insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- categories — public read
CREATE POLICY "Categories public" ON categories FOR SELECT USING (true);

-- contracts — public read for active/settled
CREATE POLICY "Contracts public" ON contracts FOR SELECT
  USING (status IN ('active','settled'));

-- coverage_tiers — public read
CREATE POLICY "Tiers public" ON coverage_tiers FOR SELECT USING (true);

-- hedger_positions — own only
CREATE POLICY "Own hedger positions" ON hedger_positions FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Insert hedger position" ON hedger_positions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- provider_positions — own only
CREATE POLICY "Own provider positions" ON provider_positions FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Insert provider position" ON provider_positions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- payouts — own only (via hedger_position)
CREATE POLICY "Own payouts" ON payouts FOR SELECT USING (
  auth.uid() = (
    SELECT user_id FROM hedger_positions WHERE id = hedger_position_id
  )
);

-- oracle_readings and pricing_history — public read
CREATE POLICY "Oracle public"  ON oracle_readings  FOR SELECT USING (true);
CREATE POLICY "Pricing public" ON pricing_history  FOR SELECT USING (true);

-- ─── AUTO-CREATE PROFILE ON SIGNUP ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', '')
  );
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();
