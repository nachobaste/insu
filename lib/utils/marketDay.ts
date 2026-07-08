/**
 * All live markets (CDMX, Guatemala City) sit permanently at UTC-6 — Mexico
 * abolished DST in 2023 and Guatemala never observed it — and the oracle
 * window logic (lib/oracle/poll.ts isWithinWindow) already anchors to this
 * zone. Payout trigger-days and the purchase gate must bucket by the same
 * local day: evening windows run 23:00–02:00 UTC, so bucketing by UTC date
 * splits one rush hour into two "days" (double-paying Pro positions) and
 * reopens purchases at 00:00 UTC mid-window.
 */
const MARKET_TIMEZONE = 'America/Mexico_City'

/** YYYY-MM-DD of the given instant in market-local time. */
export function marketDay(at: Date | string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at))
}

/** UTC instant at which the given market-local day begins (00:00 UTC-6). */
export function marketDayStartUtc(day: string): string {
  return `${day}T06:00:00Z`
}
