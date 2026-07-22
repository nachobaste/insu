-- Read-only shadow table for the TomTom cross-check spike. NOTHING in the live
-- trigger/pricing/dailySeries pipeline reads this table; it only records TomTom
-- routing + incident data alongside a snapshot of the matching Google reading so
-- we can compare sources offline.
-- Spec: docs/superpowers/specs/2026-07-21-tomtom-crosscheck-spike-design.md
CREATE TABLE IF NOT EXISTS tomtom_crosscheck (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corridor_id           uuid REFERENCES corridors(id),
  captured_at           timestamptz NOT NULL DEFAULT now(),
  in_window             boolean,
  tomtom_covered        boolean,
  tt_live_s             integer,
  tt_free_flow_s        integer,
  tt_historic_s         integer,
  tt_delay_s            integer,
  tt_index_vs_historic  numeric,
  tt_index_vs_free_flow numeric,
  tt_incident_count     integer,
  tt_incidents          jsonb,
  tt_max_magnitude      integer,
  google_duration_s     integer,
  google_baseline_s     integer,
  google_traffic_index  numeric,
  google_reading_at     timestamptz,
  raw                   jsonb
);

CREATE INDEX IF NOT EXISTS tomtom_crosscheck_corridor_captured_idx
  ON tomtom_crosscheck (corridor_id, captured_at DESC);
