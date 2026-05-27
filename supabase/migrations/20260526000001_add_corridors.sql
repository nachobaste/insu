-- Add corridors table and wire it to contracts + oracle_readings

CREATE TABLE corridors (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug         text UNIQUE NOT NULL,
  name         text NOT NULL,
  road         text NOT NULL,
  origin_lat   numeric NOT NULL,
  origin_lng   numeric NOT NULL,
  dest_lat     numeric NOT NULL,
  dest_lng     numeric NOT NULL,
  window_start time NOT NULL,
  window_end   time NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Public read — corridor data is not sensitive
ALTER TABLE corridors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Corridors public" ON corridors FOR SELECT USING (true);

-- FK on contracts (nullable — only urban/corridor contracts have one)
ALTER TABLE contracts ADD COLUMN corridor_id uuid REFERENCES corridors(id);

-- Update oracle_readings source enum: add google_maps, remove waze
ALTER TABLE oracle_readings
  DROP CONSTRAINT oracle_readings_source_check;

ALTER TABLE oracle_readings
  ADD CONSTRAINT oracle_readings_source_check
  CHECK (source IN ('openweathermap', 'tomorrow_io', 'google_maps', 'manual'));
