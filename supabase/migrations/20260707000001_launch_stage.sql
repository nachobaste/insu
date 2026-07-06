-- Launch-stage cleanup: separate purchasable products (working oracle + live
-- pricing) from Coming Soon teasers, and cancel expired demo contracts.
-- See docs/superpowers/specs/2026-07-06-coming-soon-cleanup-design.md.
--
-- NOTE: bad-bunny-cancelled is curated as coming_soon (NOT cancelled) because
-- it carries an active provider position (~$2,000 deposited). Cancel it
-- manually once that position is settled/refunded.

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

-- 4) Curation. Guard: never cancel a contract someone actively holds —
--    neither buyers (hedger_positions) nor capital providers (provider_positions).
DO $$
DECLARE
  n int;
  cancel_slugs text[] := ARRAY[
    'earthquakes-7-june-30','cdmx-marathon-rain','oaxaca-food-festival',
    'karol-g-medellin-cancelled','lollapalooza-bsas-cancelled',
    'monterrey-tech-summit','carnaval-rio-shortened','patagonia-trail-closed',
    'diablos-rojos-vs-tigres-de-quintana-roo-mp99hwh4'];
BEGIN
  SELECT
    (SELECT count(*) FROM hedger_positions hp
       JOIN contracts c ON c.id = hp.contract_id
      WHERE hp.status = 'active' AND c.slug = ANY(cancel_slugs))
  + (SELECT count(*) FROM provider_positions pp
       JOIN contracts c ON c.id = pp.contract_id
      WHERE pp.status = 'active' AND c.slug = ANY(cancel_slugs))
  INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'Refusing to cancel demo contracts: % active position(s) exist', n;
  END IF;
END $$;

-- Evergreen teasers stay browsable as Coming Soon. bad-bunny-cancelled is
-- included here (not in the cancel list) because it holds an active provider
-- position; cancel it manually once that position is settled/refunded.
UPDATE contracts SET launch_stage = 'coming_soon'
WHERE slug IN (
  'caribbean-hurricane-landfall','guadalajara-flash-flood','cabo-heatwave',
  'cancun-beach-closure','whistler-snow-20cm','amazon-flood-alert',
  'sao-paulo-metro-shutdown','gas-price-guatemala-q45',
  'bogota-water-shortage','buenos-aires-blackout',
  'bad-bunny-cancelled');

-- Dated/expired demos disappear from browse (still visible in admin).
UPDATE contracts SET status = 'cancelled'
WHERE slug IN (
  'earthquakes-7-june-30','cdmx-marathon-rain','oaxaca-food-festival',
  'karol-g-medellin-cancelled','lollapalooza-bsas-cancelled',
  'monterrey-tech-summit','carnaval-rio-shortened','patagonia-trail-closed',
  'diablos-rojos-vs-tigres-de-quintana-roo-mp99hwh4')
  AND status NOT IN ('settled','cancelled');
