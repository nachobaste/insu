-- Bring the São Paulo metro-shutdown contract in line with the traffic
-- corridors. It's the same "couldn't get where I needed to" disruption cover,
-- so it should pay similar amounts rather than read as a windfall:
--   Basic  $300  -> $100
--   Pro    $1,200 -> $500   (per event, up to 3x => $1,500 max)
--
-- Premium is linear in payout, so live quotes recompute on their own; the
-- static premium stickers are scaled by the same ratio (Basic x1/3, Pro x5/12).
-- Targeted by slug since this contract triggers on a metro-shutdown signal,
-- not traffic_index.

UPDATE coverage_tiers t
SET payout_usd  = 100,
    payout_mxn  = 1700,
    premium_usd = 5.76,
    premium_mxn = 340
FROM contracts c
WHERE t.contract_id = c.id
  AND c.slug = 'sao-paulo-metro-shutdown'
  AND t.name = 'basic';

UPDATE coverage_tiers t
SET payout_usd  = 500,
    payout_mxn  = 8500,
    premium_usd = 28.94,
    premium_mxn = 2479
FROM contracts c
WHERE t.contract_id = c.id
  AND c.slug = 'sao-paulo-metro-shutdown'
  AND t.name = 'premium';
