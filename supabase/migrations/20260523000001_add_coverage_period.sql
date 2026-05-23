ALTER TABLE hedger_positions
  ADD COLUMN IF NOT EXISTS coverage_period_days integer;
