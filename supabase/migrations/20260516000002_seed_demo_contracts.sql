-- Demo contracts and coverage tiers
-- created_by: the seeded admin user

DO $$
DECLARE
  admin_id uuid := '58bbb04f-333c-4ffd-92c3-89f994586e23';

  -- contract ids
  c_traffic    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  c_flood      uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  c_heat       uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  c_marathon   uuid := 'aaaaaaaa-0000-0000-0000-000000000004';
  c_festival   uuid := 'aaaaaaaa-0000-0000-0000-000000000005';
  c_summit     uuid := 'aaaaaaaa-0000-0000-0000-000000000006';
BEGIN

-- ─── CONTRACTS ──────────────────────────────────────────────────────────────

INSERT INTO contracts (
  id, slug, title, description, category_id, status,
  trigger_type, trigger_condition, trigger_deadline, location,
  total_volume_usd, total_volume_mxn, is_featured, created_by
) VALUES

-- 1. CDMX Morning Traffic
(c_traffic,
 'cdmx-traffic-delay',
 'CDMX Morning Traffic Delay',
 'Pays out if the Viaducto–Insurgentes corridor reports a traffic index above 85 during the morning rush (7–10 AM) on the trigger date. Ideal for commuters and delivery businesses.',
 '11111111-0000-0000-0000-000000000001', 'active',
 'urban',
 '{"metric": "traffic_index", "operator": ">", "threshold": 85, "window": "07:00–10:00"}',
 '2026-07-04 10:00:00+00',
 '{"city": "Mexico City", "corridor": "Viaducto–Insurgentes", "lat": 19.3978, "lng": -99.1647}',
 18400, 312800, true, admin_id),

-- 2. Guadalajara Flash Flood
(c_flood,
 'guadalajara-flash-flood',
 'Guadalajara Flash Flood',
 'Triggers when Guadalajara receives more than 40 mm of rain in a 24-hour period during the rainy season. Covers property disruptions, business closures, and event cancellations.',
 '11111111-0000-0000-0000-000000000002', 'active',
 'weather',
 '{"metric": "rain_mm", "operator": ">", "threshold": 40, "window_hours": 24}',
 '2026-08-15 06:00:00+00',
 '{"city": "Guadalajara", "lat": 20.6597, "lng": -103.3496}',
 31200, 530400, true, admin_id),

-- 3. Cabo Heatwave
(c_heat,
 'cabo-heatwave',
 'Cabo San Lucas Heatwave',
 'Pays out when the recorded temperature in Cabo San Lucas exceeds 40 °C during peak tourist season. Protection for hospitality operators and outdoor events.',
 '11111111-0000-0000-0000-000000000002', 'active',
 'weather',
 '{"metric": "temp_c", "operator": ">", "threshold": 40}',
 '2026-09-01 18:00:00+00',
 '{"city": "Cabo San Lucas", "lat": 22.8905, "lng": -109.9167}',
 9750, 165750, false, admin_id),

-- 4. CDMX Marathon Rain
(c_marathon,
 'cdmx-marathon-rain',
 'CDMX Marathon Rain Cover',
 'Protection for runners and sponsors if race-day rainfall exceeds 20 mm in the 6 hours before or during the Mexico City Marathon. Automatically verified via OpenWeatherMap.',
 '11111111-0000-0000-0000-000000000003', 'active',
 'weather',
 '{"metric": "rain_mm", "operator": ">", "threshold": 20, "window_hours": 6}',
 '2026-08-30 07:00:00+00',
 '{"city": "Mexico City", "race": "CDMX Marathon", "lat": 19.4326, "lng": -99.1332}',
 22100, 375700, true, admin_id),

-- 5. Oaxaca Street Food Festival
(c_festival,
 'oaxaca-food-festival',
 'Oaxaca Street Food Festival',
 'Covers vendors and attendees if the Oaxaca Guelaguetza food fair is disrupted by rain exceeding 25 mm on event day. Payout is automatic — no claims needed.',
 '11111111-0000-0000-0000-000000000003', 'active',
 'weather',
 '{"metric": "rain_mm", "operator": ">", "threshold": 25, "window_hours": 12}',
 '2026-07-20 12:00:00+00',
 '{"city": "Oaxaca", "event": "Guelaguetza Food Fair", "lat": 17.0732, "lng": -96.7266}',
 7800, 132600, false, admin_id),

-- 6. Monterrey Tech Summit
(c_summit,
 'monterrey-tech-summit',
 'Monterrey Tech Summit Cancellation',
 'Protection against venue cancellation or force-majeure closure of the Monterrey Innovation Summit. Verified by oracle administrators — payouts processed within 4 hours of trigger confirmation.',
 '11111111-0000-0000-0000-000000000004', 'active',
 'manual',
 '{"metric": "manual_override", "description": "Venue cancellation or government-ordered closure"}',
 '2026-09-18 09:00:00+00',
 '{"city": "Monterrey", "venue": "Cintermex", "lat": 25.6866, "lng": -100.3161}',
 14600, 248200, false, admin_id)

ON CONFLICT (id) DO NOTHING;

-- ─── COVERAGE TIERS ─────────────────────────────────────────────────────────

INSERT INTO coverage_tiers (
  contract_id, name,
  premium_usd, payout_usd, premium_mxn, payout_mxn,
  max_capacity_usd, current_capacity_usd,
  base_probability, last_priced_at
) VALUES

-- CDMX Traffic
(c_traffic, 'basic',   29,  500,  493, 8500,  80000, 11200, 0.38, now()),
(c_traffic, 'premium', 89, 2000, 1513, 34000, 50000,  7200, 0.38, now()),

-- Guadalajara Flood
(c_flood, 'basic',   39,  800,  663, 13600, 100000, 18500, 0.45, now()),
(c_flood, 'premium', 119, 3500, 2023, 59500,  60000, 12700, 0.45, now()),

-- Cabo Heatwave
(c_heat, 'basic',   19,  400,  323,  6800,  60000, 5200, 0.52, now()),
(c_heat, 'premium', 59, 1500, 1003, 25500,  40000, 4550, 0.52, now()),

-- CDMX Marathon
(c_marathon, 'basic',   24,  450,  408,  7650,  75000, 13400, 0.35, now()),
(c_marathon, 'premium', 79, 2000, 1343, 34000,  50000,  8700, 0.35, now()),

-- Oaxaca Festival
(c_festival, 'basic',   18,  350,  306,  5950,  50000, 4600, 0.42, now()),
(c_festival, 'premium', 55, 1200,  935, 20400,  30000, 3200, 0.42, now()),

-- Monterrey Summit
(c_summit, 'basic',   35,  700,  595, 11900,  60000,  8800, 0.28, now()),
(c_summit, 'premium', 99, 3000, 1683, 51000,  40000,  5800, 0.28, now());

END $$;
