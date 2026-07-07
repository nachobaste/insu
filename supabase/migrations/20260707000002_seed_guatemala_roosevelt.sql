-- Second Guatemala City traffic corridor: Zona 11 (Tikal Futura / Calzada
-- Roosevelt at the Periférico) <-> San Lucas Sacatepéquez centro (CA-1
-- Occidente / Interamericana km ~29.5), ~19.5 km through the Mixco bottleneck.
-- Endpoints validated against the Google Routes API on 2026-07-06: free-flow
-- ~30 min each way; evening rush measured at +49% outbound.
-- AM = San Lucas -> Zona 11 (bedroom-suburb inbound), PM = reversed.
-- Windows 07:00-10:00 / 17:00-20:00 local (UTC-6): covered by the existing
-- urban oracle cron with no extra config. baseline_duration_s starts NULL ->
-- oracle falls back to Google free-flow until compute-corridor-baselines.mjs
-- runs with enough history. path_polyline backfills on first in-window poll.
-- Idempotent: ON CONFLICT / NOT EXISTS guards so re-running is safe.

INSERT INTO corridors (slug, name, road, origin_lat, origin_lng, dest_lat, dest_lng, window_start, window_end)
VALUES
(
  'gt-roosevelt-zona11-am',
  'San Lucas → Zona 11 (Mañana)',
  'Calzada Roosevelt / CA-1 Occidente (Interamericana)',
  14.6097, -90.6553,   -- origin: San Lucas Sacatepéquez centro (CA-1 km ~29.5)
  14.6215, -90.5552,   -- dest: Tikal Futura / Calz. Roosevelt & Anillo Periférico (Zona 11)
  '07:00', '10:00'
),
(
  'gt-roosevelt-sanlucas-pm',
  'Zona 11 → San Lucas (Tarde)',
  'Calzada Roosevelt / CA-1 Occidente (Interamericana)',
  14.6215, -90.5552,   -- origin: Tikal Futura / Calz. Roosevelt & Anillo Periférico (Zona 11)
  14.6097, -90.6553,   -- dest: San Lucas Sacatepéquez centro (CA-1 km ~29.5)
  '17:00', '20:00'
)
ON CONFLICT (slug) DO NOTHING;

-- Contracts + tiers (recurring, perpetual markets) referencing the corridors.
DO $$
DECLARE
  admin_id  uuid := '4e68ce38-e75d-470c-bf5f-e72511f94b18';  -- Gerardo Basterrechea (admin)
  urban_cat uuid;
  cor_am    uuid;
  cor_pm    uuid;
  c_am      uuid := 'bbbbbbbb-0007-0000-0000-000000000003';  -- deterministic for idempotency
  c_pm      uuid := 'bbbbbbbb-0007-0000-0000-000000000004';
BEGIN
  SELECT id INTO urban_cat FROM categories WHERE slug = 'urban';
  SELECT id INTO cor_am   FROM corridors  WHERE slug = 'gt-roosevelt-zona11-am';
  SELECT id INTO cor_pm   FROM corridors  WHERE slug = 'gt-roosevelt-sanlucas-pm';

  IF urban_cat IS NULL THEN
    RAISE EXCEPTION 'Category "urban" not found — run category seed migration first';
  END IF;
  IF cor_am IS NULL OR cor_pm IS NULL THEN
    RAISE EXCEPTION 'Roosevelt corridors not found — corridor insert above did not run';
  END IF;

  INSERT INTO contracts (
    id, slug, title, description, category_id, status,
    trigger_type, trigger_condition, trigger_deadline,
    location, corridor_id, total_volume_usd, total_volume_mxn,
    is_featured, is_recurring, created_by
  ) VALUES
  (
    c_am,
    'gt-sanlucas-zona11-manana',
    'San Lucas → Zona 11 — Protección Mañana',
    'Cobertura para el trayecto matutino desde San Lucas Sacatepéquez hacia la Zona 11 (Tikal Futura) por la Calzada Roosevelt / CA-1 Occidente. Paga si el tiempo de traslado supera 50% del normal.',
    urban_cat, 'active', 'urban',
    '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
    NULL,  -- recurring market: no deadline
    '{"city":"Guatemala City","country":"GT","lat":14.6215,"lng":-90.5552}',
    cor_am, 0, 0,
    false, true, admin_id
  ),
  (
    c_pm,
    'gt-zona11-sanlucas-tarde',
    'Zona 11 → San Lucas — Protección Tarde',
    'Cobertura para el trayecto vespertino desde la Zona 11 (Tikal Futura) hacia San Lucas Sacatepéquez por la Calzada Roosevelt / CA-1 Occidente. Paga si el tiempo de traslado supera 50% del normal.',
    urban_cat, 'active', 'urban',
    '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
    NULL,
    '{"city":"Guatemala City","country":"GT","lat":14.6215,"lng":-90.5552}',
    cor_pm, 0, 0,
    false, true, admin_id
  )
  ON CONFLICT (id) DO NOTHING;

  -- Tiers: match the other traffic contracts' current prod values (post
  -- 2026-06-24 payout lowering + base_probability raise): Basic $6 -> $100 x1,
  -- Pro $22 -> $500 x3, 0.12/day.
  IF NOT EXISTS (SELECT 1 FROM coverage_tiers WHERE contract_id = c_am) THEN
    INSERT INTO coverage_tiers
      (contract_id, name, premium_usd, payout_usd, premium_mxn, payout_mxn, max_capacity_usd, base_probability, max_payouts)
    VALUES
      (c_am, 'basic',    6,  100,  99, 1700, 50000, 0.12, 1),
      (c_am, 'premium', 22,  500, 378, 8500, 50000, 0.12, 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM coverage_tiers WHERE contract_id = c_pm) THEN
    INSERT INTO coverage_tiers
      (contract_id, name, premium_usd, payout_usd, premium_mxn, payout_mxn, max_capacity_usd, base_probability, max_payouts)
    VALUES
      (c_pm, 'basic',    6,  100,  99, 1700, 50000, 0.12, 1),
      (c_pm, 'premium', 22,  500, 378, 8500, 50000, 0.12, 3);
  END IF;

  -- Demo funding (like 20260624000002 / 20260706000001): a brand-new contract
  -- starts at current_capacity_usd = 0, which blocks buyers. Set levels above
  -- max_payouts x payout so both the client and server purchase gates pass.
  UPDATE coverage_tiers ct
  SET current_capacity_usd = CASE ct.name
        WHEN 'basic'   THEN 12000   -- payout 100 x1 -> need >= 100
        WHEN 'premium' THEN 20000   -- payout 500 x3 -> need >= 1500
        ELSE ct.current_capacity_usd
      END
  WHERE ct.contract_id IN (c_am, c_pm)
    AND ct.current_capacity_usd = 0;
END $$;
