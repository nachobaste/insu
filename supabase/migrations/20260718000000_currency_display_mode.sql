-- supabase/migrations/20260718000000_currency_display_mode.sql
-- Repurpose profiles.preferred_currency from a fiat code to a display MODE.
-- Old values: 'USD' | 'MXN'. New values: 'USD' | 'LOCAL' (contract's local currency).
update profiles set preferred_currency = 'LOCAL' where preferred_currency = 'MXN';
