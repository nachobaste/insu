-- Provenance for corridors.baseline_duration_s so calibration reviews know
-- which values are measured medians vs Google-model-derived vs a blend.
alter table public.corridors
  add column if not exists baseline_source text
    check (baseline_source in ('harvested', 'predicted', 'blended'));

comment on column public.corridors.baseline_source is
  'How baseline_duration_s was produced: harvested (median of oracle_readings), predicted (Google future-departureTime model), blended (credibility-weighted mix).';
