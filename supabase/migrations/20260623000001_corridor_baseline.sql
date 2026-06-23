-- Typical in-window trip duration per corridor, computed from oracle history.
-- NULL means "no baseline yet" -> the oracle falls back to Google free-flow.
ALTER TABLE corridors ADD COLUMN IF NOT EXISTS baseline_duration_s integer;

COMMENT ON COLUMN corridors.baseline_duration_s IS
  'Typical in-window trip duration (seconds) from oracle history; NULL = fall back to Google free-flow staticDuration.';
