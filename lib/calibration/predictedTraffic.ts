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

export interface CorridorGeometry {
  slug: string
  origin_lat: number
  origin_lng: number
  dest_lat: number
  dest_lng: number
  window_start: string
  window_end: string
}

export interface EnvelopeDay {
  date: string
  bestS: number
  optS: number
  pessS: number
}

export interface PredictedSample {
  predictedMedianS: number
  peakSlot: string
  samples: Array<DepartureSlot & { bestS: number }>
  envelope: EnvelopeDay[]
}

async function fetchPredictedDuration(
  c: CorridorGeometry,
  departureTime: string,
  apiKey: string,
  trafficModel?: 'PESSIMISTIC' | 'OPTIMISTIC',
): Promise<number> {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.duration',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: c.origin_lat, longitude: c.origin_lng } } },
      destination: { location: { latLng: { latitude: c.dest_lat, longitude: c.dest_lng } } },
      travelMode: 'DRIVE',
      departureTime,
      // trafficModel is only accepted under TRAFFIC_AWARE_OPTIMAL (pricier SKU) —
      // grid sampling stays on the cheaper TRAFFIC_AWARE.
      ...(trafficModel
        ? { routingPreference: 'TRAFFIC_AWARE_OPTIMAL', trafficModel }
        : { routingPreference: 'TRAFFIC_AWARE' }),
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google Maps Routes API error: ${res.status} ${body}`.trim())
  }
  const data = await res.json()
  const duration = (data.routes as Array<{ duration: string }>)?.[0]?.duration
  if (!duration) throw new Error('Google Maps Routes API: no routes returned')
  return parseInt(duration.replace('s', ''), 10)
}

function medianOf(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/**
 * Full prediction sample for one corridor: BEST_GUESS durations across the
 * Mon-Fri x window grid, plus a PESSIMISTIC/OPTIMISTIC envelope at the peak
 * slot of each weekday. ~40 sequential Routes API calls (~15s).
 */
export async function samplePredictedCorridor(
  c: CorridorGeometry,
  apiKey: string,
  now: Date = new Date(),
): Promise<PredictedSample> {
  const grid = buildDepartureGrid(c.window_start, c.window_end, now)
  const samples: Array<DepartureSlot & { bestS: number }> = []
  for (const entry of grid) {
    samples.push({ ...entry, bestS: await fetchPredictedDuration(c, entry.departureTime, apiKey) })
  }

  // Peak slot = slot label with the highest median across the 5 weekdays.
  const bySlot = new Map<string, number[]>()
  for (const s of samples) bySlot.set(s.slot, [...(bySlot.get(s.slot) ?? []), s.bestS])
  let peakSlot = grid[0].slot
  let peakMedian = -Infinity
  for (const [slot, durs] of bySlot) {
    const m = medianOf(durs)
    if (m > peakMedian) { peakMedian = m; peakSlot = slot }
  }

  const envelope: EnvelopeDay[] = []
  for (const s of samples.filter((x) => x.slot === peakSlot)) {
    const [pessS, optS] = [
      await fetchPredictedDuration(c, s.departureTime, apiKey, 'PESSIMISTIC'),
      await fetchPredictedDuration(c, s.departureTime, apiKey, 'OPTIMISTIC'),
    ]
    envelope.push({ date: s.date, bestS: s.bestS, optS, pessS })
  }

  return { predictedMedianS: medianOf(samples.map((s) => s.bestS)), peakSlot, samples, envelope }
}
