-- Allow the Guatemala AGN fuel oracle (lib/oracle/guatemalaFuelFetcher.ts) to
-- write readings. Without 'agn_mem' the poll insert fails the source CHECK and
-- the reading is silently dropped by the poller's try/catch.
ALTER TABLE oracle_readings DROP CONSTRAINT IF EXISTS oracle_readings_source_check;
ALTER TABLE oracle_readings
  ADD CONSTRAINT oracle_readings_source_check
  CHECK (source IN ('openweathermap','tomorrow_io','google_maps','manual','cre_datos_gob','sedema','agn_mem'));
