-- Demo funding for the Guatemala contract: seed pool capacity so "Buy Protection"
-- is enabled. In production this capacity is filled by provider deposits (which
-- call increment_tier_capacity on payment success); a brand-new contract starts at
-- current_capacity_usd = 0, which blocks buyers. Set levels above each tier's
-- max_payouts x payout so both the client gate (cap >= payout) and the server gate
-- (cap >= max_payouts x payout, purchase.ts) pass. Idempotent (absolute values).
UPDATE coverage_tiers ct
SET current_capacity_usd = CASE ct.name
      WHEN 'basic'   THEN 12000   -- payout 500  x1  -> need >= 500
      WHEN 'premium' THEN 20000   -- payout 2000 x3  -> need >= 6000
      ELSE ct.current_capacity_usd
    END
FROM contracts c
WHERE ct.contract_id = c.id
  AND c.slug = 'gt-cesa-zona10-manana';
