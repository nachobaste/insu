# Fuel Oracle: Replace Dead datos.gob.mx Source with CRE XML Feeds

**Date:** 2026-07-04
**Status:** Approved

## Problem

The fuel oracle (`lib/oracle/gasFetcher.ts`) fetches `api.datos.gob.mx/v1/precio.gasolina.publico`, which is dead (connection timeout; the Mexican open-data API was decommissioned). The poller swallows the error, so the daily `weather,fuel` Vercel cron (16:00 UTC) reports success while the `gas-price-magna-cdmx` contract's only reading remains a manually injected demo value from 2026-06-21. The contract triggers on median CDMX Magna price > $25.00 MXN/L (`metric: price_mxn_per_liter`, `operator: gt`).

## Chosen Source

The CRE's official price publication feeds (the same government data the dead API served), verified live on 2026-07-04:

- `https://publicacionexterna.azurewebsites.net/publicaciones/prices` — HTTP 200, ~2.4 MB XML; per-station `<gas_price type="regular|premium|diesel">` current prices.
- `https://publicacionexterna.azurewebsites.net/publicaciones/places` — HTTP 200, ~3.2 MB XML; per-station name, CRE permit id, and `<location><x>lng</x><y>lat</y></location>`.

Live join produced 15,019 stations with coordinates, 697 CDMX stations with a regular price, median $23.99 MXN/L (range $20.49–$24.49).

Alternatives rejected: Data México/INEGI aggregates (state-level averages, not medians; unverified freshness) and scraping price-tracking sites (fragile, ToS concerns).

## Design

### Fetcher rewrite (`lib/oracle/gasFetcher.ts`)

Same public interface, new internals:

- `fetchGasPrice(fuelType)` fetches both feeds, joins on `place_id`.
- Fuel-type mapping unchanged: `magna → regular`, `premium → premium`, `diesel → diesel`.
- Parsing via regex over the machine-generated XML. No new dependency; ~6 MB total is acceptable for one daily serverless call.
- Return shape unchanged so `evaluateTrigger`, the insert path, and the DB constraint (which already allows `cre_datos_gob` since migration `20260703000003`) need zero changes:

```ts
{
  source: 'cre_datos_gob',
  reading_type: 'fuel',
  value: { price_mxn_per_liter: <median>, fuel_type, sample_size },
}
```

### CDMX filtering

The feeds carry no state field. Filter stations by a CDMX bounding box, defined as module constants:

- lat 19.04–19.60
- lng −99.37 to −98.93

This may include a few stations just across the Estado de México border; the median over ~700 stations is robust to that. Skip stations missing coordinates or the requested fuel type.

### Guards and error handling

- If fewer than **50** stations survive the filter, throw — protects against a half-broken feed producing a garbage median.
- Any failure (non-200, timeout, parse failure, low sample) throws; `poll.ts` already catches per-contract, logs, and skips.
- Add `AbortSignal.timeout(30_000)` to each fetch so a hung feed (how the old API died) cannot eat the invocation budget shared with the weather contracts.

### Testing

Rewrite the `gasFetcher` unit tests with small XML fixtures:

1. Happy path — median computed from CDMX stations only.
2. Station outside the bounding box excluded.
3. Station missing the requested fuel type skipped.
4. Sample below 50 throws.
5. Non-200 response throws.

The existing `poll.ts` tests already cover the fuel dispatch path.

## Rollout

1. Branch + PR; merge to main.
2. Deploy: `vercel --prod --yes` from a main checkout (prod does not auto-deploy).
3. Trigger `POST /api/oracle-poll?types=fuel` with `CRON_SECRET`; confirm a `cre_datos_gob` reading with a sane median lands in `oracle_readings`.
4. Fire the manual Reprice workflow; confirm the Magna contract's premium updates in `pricing_history`.
5. Update the memory note closing open bug #4.

## Success Criteria

Real CRE readings flow daily into `oracle_readings` for the fuel contract with a plausible median (roughly $20–$26 MXN/L today), trigger evaluation runs against them, and the premium reprices from live data instead of the stale manual reading.
