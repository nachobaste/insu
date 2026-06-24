-- Lower payouts on the CDMX traffic-corridor contracts.
--
-- Insu's traffic protection is meant to offset the disruption of being stuck
-- in traffic (a missed ride, appointment or booking) — not to function as a
-- lottery. So we cut the coverage amounts:
--   Basic  $500  -> $100   (pays once)
--   Pro    $2000 -> $500    (per event, up to 3x => $1,500 max)
--
-- Premium is derived live from payout and is linear in it
-- (premium = payout x expectedPayouts x loading x capacityFactor), so quoted
-- prices scale down proportionally on their own. The static premium stickers
-- below (shown on cards before a live quote) are scaled by the same ratio so
-- the card price/payout ratio stays sensible.
--
-- Targets every tier whose contract triggers on traffic_index, in both
-- currencies (FX ~17 MXN/USD, matching the original seed).

DO $$
DECLARE
  affected_active int;
BEGIN
  SELECT count(*) INTO affected_active
  FROM hedger_positions hp
  JOIN contracts c ON c.id = hp.contract_id
  WHERE hp.status = 'active'
    AND c.trigger_condition->>'metric' = 'traffic_index';
  RAISE NOTICE 'Lowering traffic payouts — % active position(s) affected (retroactive).', affected_active;
END $$;

UPDATE coverage_tiers t
SET payout_usd  = 100,
    payout_mxn  = 1700,
    premium_usd = 6,
    premium_mxn = 99
FROM contracts c
WHERE t.contract_id = c.id
  AND c.trigger_condition->>'metric' = 'traffic_index'
  AND t.name = 'basic';

UPDATE coverage_tiers t
SET payout_usd  = 500,
    payout_mxn  = 8500,
    premium_usd = 22,
    premium_mxn = 378
FROM contracts c
WHERE t.contract_id = c.id
  AND c.trigger_condition->>'metric' = 'traffic_index'
  AND t.name = 'premium';
