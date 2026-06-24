-- Store the encoded road-route polyline for each corridor so the contract map
-- can draw the actual road path, not just origin/dest markers. Road geometry is
-- effectively static, so it's fetched once (scripts/backfill-corridor-polylines.mjs
-- via the Google Routes API) and reused on every map render — no per-view API cost.

ALTER TABLE corridors ADD COLUMN IF NOT EXISTS path_polyline text;
