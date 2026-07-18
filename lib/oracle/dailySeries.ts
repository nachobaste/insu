import { marketDay } from '@/lib/utils/marketDay'
import type { OracleReading } from '@/lib/types'

// Both live markets (CDMX, Guatemala City) sit permanently at UTC-6; the same
// zone TrafficPulseBar and lib/oracle/poll.ts anchor to. See lib/utils/marketDay.ts.
const MARKET_TIMEZONE = 'America/Mexico_City'

export interface DailyMetricPoint {
  /** YYYY-MM-DD in market-local time. */
  date: string
  value: number
}

/** Minutes since local midnight (market tz) for an instant. */
function localMinutes(iso: string): number {
  const hm = new Intl.DateTimeFormat('en-US', {
    timeZone: MARKET_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

/** 'HH:MM[:SS]' -> minutes since midnight. */
function windowMinutes(t: string): number {
  const [h, m] = t.substring(0, 5).split(':').map(Number)
  return h * 60 + m
}

/**
 * One point per day = the max of the trigger metric.
 *
 * When `window` is given (corridor contracts), only readings whose market-local
 * time falls within [start, end) count — the value that determines a trigger.
 * The day key is the market-local date (marketDay). Windows spanning midnight
 * are unsupported (all corridors are daytime), matching TrafficPulseBar.
 *
 * When `window` is null (air quality, flood, fuel — UTC-published feeds), the
 * day key is the UTC calendar date (read_at ISO slice). No time filter is
 * applied; all readings contribute to their UTC day's max.
 */
export function aggregateDailyOracleSeries(
  readings: Pick<OracleReading, 'read_at' | 'value'>[],
  metric: string,
  window: { start: string; end: string } | null,
): DailyMetricPoint[] {
  const start = window ? windowMinutes(window.start) : 0
  const end = window ? windowMinutes(window.end) : 0
  const maxByDay = new Map<string, number>()

  for (const r of readings) {
    const raw = (r.value as Record<string, unknown>)[metric]
    const v = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(v)) continue
    if (window) {
      const mins = localMinutes(r.read_at)
      if (mins < start || mins >= end) continue
    }
    // Corridor contracts bucket by market-local day (UTC-6); non-corridor feeds
    // (air quality, flood, fuel) publish on UTC calendar days so we use the UTC
    // date to avoid splitting a single publish day across two market-local days.
    const day = window ? marketDay(r.read_at) : r.read_at.substring(0, 10)
    const prev = maxByDay.get(day)
    if (prev === undefined || v > prev) maxByDay.set(day, v)
  }

  return [...maxByDay.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

const METRIC_LABELS: Record<string, string> = {
  traffic_index: 'Traffic index',
  aqi: 'Air quality',
  imeca: 'Air quality',
  pm25: 'Air quality',
  rainfall: 'Rainfall',
  precipitation: 'Rainfall',
  fuel_price: 'Fuel price',
}

/** Human label for a trigger metric key; falls back to a de-underscored key. */
export function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric.replace(/_/g, ' ')
}
