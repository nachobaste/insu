-- Launch-stage cleanup: separate purchasable products (working oracle + live
-- pricing) from Coming Soon teasers, and cancel expired demo contracts.
-- See docs/superpowers/specs/2026-07-06-coming-soon-cleanup-design.md.

-- 1) Explicit launch stage. Default 'live' so existing purchase/payout flows
--    and future oracle-backed contracts are unaffected unless curated.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS launch_stage text NOT NULL DEFAULT 'live'
  CHECK (launch_stage IN ('live','coming_soon'));

-- 2) Allow the new notification type used when a product flips live.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('coverage_paid','coverage_expired','protection_purchased',
                  'provider_settled','product_launched'));

-- 3) Notify-me interest for coming-soon products. Owner-scoped RLS; the
--    launch fan-out reads it with the service client.
CREATE TABLE launch_interest (
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, contract_id)
);

ALTER TABLE launch_interest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own interest select" ON launch_interest FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Own interest insert" ON launch_interest FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own interest delete" ON launch_interest FOR DELETE
  USING (auth.uid() = user_id);

-- 4) Curation. Guard: never cancel a contract someone actively holds.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM hedger_positions hp
  JOIN contracts c ON c.id = hp.contract_id
  WHERE hp.status = 'active'
    AND c.slug IN (
      'earthquakes-7-june-30','cdmx-marathon-rain','oaxaca-food-festival',
      'bad-bunny-cancelled','karol-g-medellin-cancelled','lollapalooza-bsas-cancelled',
      'monterrey-tech-summit','carnaval-rio-shortened','patagonia-trail-closed',
      'diablos-rojos-vs-tigres-de-quintana-roo-mp99hwh4');
  IF n > 0 THEN
    RAISE EXCEPTION 'Refusing to cancel demo contracts: % active position(s) exist', n;
  END IF;
END $$;

-- Evergreen teasers stay browsable as Coming Soon.
UPDATE contracts SET launch_stage = 'coming_soon'
WHERE slug IN (
  'caribbean-hurricane-landfall','guadalajara-flash-flood','cabo-heatwave',
  'cancun-beach-closure','whistler-snow-20cm','amazon-flood-alert',
  'sao-paulo-metro-shutdown','gas-price-guatemala-q45',
  'bogota-water-shortage','buenos-aires-blackout');

-- Dated/expired demos disappear from browse (still visible in admin).
UPDATE contracts SET status = 'cancelled'
WHERE slug IN (
  'earthquakes-7-june-30','cdmx-marathon-rain','oaxaca-food-festival',
  'bad-bunny-cancelled','karol-g-medellin-cancelled','lollapalooza-bsas-cancelled',
  'monterrey-tech-summit','carnaval-rio-shortened','patagonia-trail-closed',
  'diablos-rojos-vs-tigres-de-quintana-roo-mp99hwh4')
  AND status NOT IN ('settled','cancelled');
