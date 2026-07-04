-- Add air_quality + flood trigger types and the sedema reading source.
-- Recreates both CHECK constraints with the full known set. Also restores
-- cre_datos_gob to the source check (a latent gap from the fuel work), matching
-- lib/types.ts which already lists it.

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_trigger_type_check;
ALTER TABLE contracts
  ADD CONSTRAINT contracts_trigger_type_check
  CHECK (trigger_type IN ('weather','urban','event','manual','fuel','air_quality','flood'));

ALTER TABLE oracle_readings DROP CONSTRAINT IF EXISTS oracle_readings_source_check;
ALTER TABLE oracle_readings
  ADD CONSTRAINT oracle_readings_source_check
  CHECK (source IN ('openweathermap','tomorrow_io','google_maps','manual','cre_datos_gob','sedema'));
