// Samples Google's historical traffic model by requesting routes at FUTURE
// departure times (past departureTime is transit-only). Server-side only:
// requires the Routes-API-enabled GOOGLE_MAPS_API_KEY.

const UTC_OFFSET_HOURS = 6 // CDMX and Guatemala City are both fixed UTC-6 (no DST)
const DAY_MS = 86_400_000

export interface DepartureSlot {
  departureTime: string // ISO UTC, e.g. 2026-07-13T13:00:00Z
  date: string // local calendar date of the slot, YYYY-MM-DD
  slot: string // local time label, e.g. 07:30
}

/**
 * Grid of departure times covering Mon-Fri of the next full week (strictly in
 * the future) at `intervalMin` steps across the corridor's local window.
 */
export function buildDepartureGrid(
  windowStart: string,
  windowEnd: string,
  from: Date,
  intervalMin = 30,
): DepartureSlot[] {
  const startOfDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const daysUntilMonday = (8 - startOfDay.getUTCDay()) % 7 || 7
  const monday = new Date(startOfDay.getTime() + daysUntilMonday * DAY_MS)

  const [sh, sm] = windowStart.split(':').map(Number)
  const [eh, em] = windowEnd.split(':').map(Number)
  const slots: DepartureSlot[] = []
  for (let d = 0; d < 5; d++) {
    const day = new Date(monday.getTime() + d * DAY_MS)
    for (let t = sh * 60 + sm; t < eh * 60 + em; t += intervalMin) {
      const utc = new Date(
        Date.UTC(
          day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(),
          Math.floor(t / 60) + UTC_OFFSET_HOURS, t % 60,
        ),
      )
      slots.push({
        departureTime: utc.toISOString().replace('.000Z', 'Z'),
        date: day.toISOString().slice(0, 10),
        slot: `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`,
      })
    }
  }
  return slots
}
