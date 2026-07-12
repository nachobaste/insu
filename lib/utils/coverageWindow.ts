/**
 * Which corridor rush-hour windows does a position actually cover?
 *
 * Coverage runs [purchase, purchase + N×24h] while settlement buckets
 * trigger-days by market-local date (lib/payout/processor.ts), so a "1 day"
 * buy at 11am covers tomorrow's window, not today's. These helpers enumerate
 * the covered window-days so the purchase UI can say exactly which dates are
 * protected. All math uses the fixed UTC-6 market zone (see marketDay.ts) —
 * never the browser's local zone.
 */

const TZ_OFFSET_MS = 6 * 60 * 60 * 1000 // market local = UTC-6, permanently
const DAY_MS = 24 * 60 * 60 * 1000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface CoveredWindowDay {
  /** YYYY-MM-DD, market-local. */
  day: string
  /** 'HH:MM' market-local — set when coverage begins mid-window on this day. */
  from?: string
  /** 'HH:MM' market-local — set when coverage ends mid-window on this day. */
  until?: string
}

/** 'HH:MM' or 'HH:MM:SS' → minutes since local midnight. */
function parseTime(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Shifted date whose getUTC* fields read as market-local. */
function asLocal(utcMs: number): Date {
  return new Date(utcMs - TZ_OFFSET_MS)
}

function hhmm(utcMs: number): string {
  const d = asLocal(utcMs)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** YYYY-MM-DD of the local day that begins at the given UTC instant. */
function dayKey(localMidnightUtcMs: number): string {
  const d = asLocal(localMidnightUtcMs)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/**
 * Enumerate the market-local days whose [windowStart, windowEnd) rush window
 * overlaps the coverage interval [start, start + periodDays×24h], matching
 * the payout processor's per-day eligibility (trigger must land at or after
 * purchase and before expiry).
 */
export function coveredWindowDays(
  start: Date | string,
  periodDays: number,
  windowStart: string,
  windowEnd: string,
): CoveredWindowDay[] {
  const startMs = new Date(start).getTime()
  const endMs = startMs + periodDays * DAY_MS
  const wsMin = parseTime(windowStart)
  const weMin = parseTime(windowEnd)

  const local = asLocal(startMs)
  let midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + TZ_OFFSET_MS

  const out: CoveredWindowDay[] = []
  for (; midnight < endMs; midnight += DAY_MS) {
    const wStart = midnight + wsMin * 60_000
    const wEnd = midnight + weMin * 60_000
    const overlapStart = Math.max(startMs, wStart)
    const overlapEnd = Math.min(endMs, wEnd)
    if (overlapStart >= overlapEnd) continue
    out.push({
      day: dayKey(midnight),
      ...(overlapStart > wStart ? { from: hhmm(overlapStart) } : {}),
      ...(overlapEnd < wEnd ? { until: hhmm(overlapEnd) } : {}),
    })
  }
  return out
}

/** '06:00:00' → '6am'; '11:30:00' → '11:30am'. */
function timeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const suffix = h < 12 ? 'am' : 'pm'
  const hour = h % 12 || 12
  return m === 0 ? `${hour}${suffix}` : `${hour}:${m.toString().padStart(2, '0')}${suffix}`
}

/** '06:00'–'10:00' → '6–10am'; '11:30'–'13:00' → '11:30am–1pm'. */
function windowLabel(windowStart: string, windowEnd: string): string {
  const startLabel = timeLabel(windowStart)
  const endLabel = timeLabel(windowEnd)
  const sameSuffix = startLabel.slice(-2) === endLabel.slice(-2)
  return sameSuffix
    ? `${startLabel.slice(0, -2)}–${endLabel}`
    : `${startLabel}–${endLabel}`
}

/** 'YYYY-MM-DD' → 'Jul 13' (or 'Jul 13, 2026' / 'Mon, Jul 13'). */
function dayLabel(day: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const [y, m, d] = day.split('-').map(Number)
  const base = `${MONTHS[m - 1]} ${d}`
  const withYear = opts.year ? `${base}, ${y}` : base
  if (!opts.weekday) return withYear
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${weekday}, ${withYear}`
}

function boundaryNote(d: CoveredWindowDay): string {
  if (d.from) return ` (from ${timeLabel(d.from)})`
  if (d.until) return ` (until ${timeLabel(d.until)})`
  return ''
}

/**
 * Human label for a covered-window list, e.g.
 * 'the 6–10am window on Mon, Jul 13' or
 * 'the 6–10am window daily, Jul 13 – Jul 19'.
 */
export function formatCoveredWindows(
  days: CoveredWindowDay[],
  windowStart: string,
  windowEnd: string,
): string {
  if (days.length === 0) return ''
  const win = windowLabel(windowStart, windowEnd)
  const first = days[0]
  const last = days[days.length - 1]
  if (days.length === 1) {
    return `the ${win} window on ${dayLabel(first.day, { weekday: true })}${boundaryNote(first)}`
  }
  const crossesYear = first.day.slice(0, 4) !== last.day.slice(0, 4)
  const firstLabel = dayLabel(first.day, { year: crossesYear })
  const lastLabel = dayLabel(last.day, { year: crossesYear })
  return `the ${win} window daily, ${firstLabel}${boundaryNote(first)} – ${lastLabel}${boundaryNote(last)}`
}

/**
 * Plain start–end label for recurring contracts without a rush window
 * (flood, air quality, fuel), in market-local time: 'Jul 12, 2:34pm – Aug 11, 2:34pm'.
 */
export function formatCoverageRange(start: Date | string, periodDays: number): string {
  const startMs = new Date(start).getTime()
  const endMs = startMs + periodDays * DAY_MS
  const point = (ms: number) => {
    const d = asLocal(ms)
    const day = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
    return `${day}, ${timeLabel(hhmm(ms))}`
  }
  return `${point(startMs)} – ${point(endMs)}`
}
