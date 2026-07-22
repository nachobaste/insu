import { describe, it, expect, vi } from 'vitest'
import { runTomTomCrossCheck } from '@/lib/oracle/crosscheck'
import type { TomTomRouteReading, TomTomIncidentReading } from '@/lib/oracle/tomtomFetcher'

const coveredRoute: TomTomRouteReading = {
  covered: true, liveS: 1712, freeFlowS: 1572, historicS: 1600,
  delayS: 40, indexVsHistoric: 7, indexVsFreeFlow: 9, raw: { r: 1 },
}
const someIncidents: TomTomIncidentReading = {
  count: 2, byCategory: { jam: 2 }, maxMagnitude: 3, raw: { i: 1 },
}

// Corridor windows: 00:00-23:59 is always "in window"; 00:00-00:00 never is.
function corridor(window_start: string, window_end: string) {
  return {
    id: 'corr-1', slug: 'reforma-am',
    origin_lat: 19.41, origin_lng: -99.20, dest_lat: 19.47, dest_lng: -99.17,
    window_start, window_end, baseline_duration_s: 1600,
  }
}
function urbanContract(corr: ReturnType<typeof corridor> | null) {
  return { id: 'c1', trigger_type: 'urban', status: 'active', settled_outcome: null, corridor: corr }
}

function chainable(value: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'gte', 'order', 'limit']) b[m] = vi.fn().mockReturnValue(b)
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(value).then(res)
  return b
}
function makeDb(opts: { contracts?: unknown[]; googleRows?: unknown[] } = {}) {
  const insertMock = vi.fn().mockResolvedValue({ error: null })
  return {
    from: vi.fn((table: string) => {
      if (table === 'contracts') return chainable({ data: opts.contracts ?? [], error: null })
      if (table === 'oracle_readings') return chainable({ data: opts.googleRows ?? [], error: null })
      if (table === 'tomtom_crosscheck') return { insert: insertMock }
      return {}
    }),
    _insert: insertMock,
  }
}
const deps = (route = coveredRoute, incidents: TomTomIncidentReading | 'throw' = someIncidents) => ({
  fetchRoute: vi.fn().mockResolvedValue(route),
  fetchIncidents: incidents === 'throw'
    ? vi.fn().mockRejectedValue(new Error('incidents down'))
    : vi.fn().mockResolvedValue(incidents),
})

describe('runTomTomCrossCheck', () => {
  it('writes one crosscheck row for an in-window corridor, joining the Google snapshot', async () => {
    const db = makeDb({
      contracts: [urbanContract(corridor('00:00', '23:59'))],
      googleRows: [{ value: { duration_s: 1800, baseline_duration_s: 1600, traffic_index: 12 }, read_at: '2026-07-21T15:00:00Z' }],
    })
    const d = deps()
    const n = await runTomTomCrossCheck(db as never, d)
    expect(n).toBe(1)
    expect(d.fetchRoute).toHaveBeenCalledWith(19.41, -99.20, 19.47, -99.17)
    expect(d.fetchIncidents).toHaveBeenCalledWith({ minLon: -99.20, minLat: 19.41, maxLon: -99.17, maxLat: 19.47 })
    const row = db._insert.mock.calls[0][0]
    expect(row).toMatchObject({
      corridor_id: 'corr-1', tomtom_covered: true, tt_live_s: 1712, tt_historic_s: 1600,
      tt_index_vs_historic: 7, tt_incident_count: 2, tt_max_magnitude: 3,
      google_duration_s: 1800, google_baseline_s: 1600, google_traffic_index: 12,
      google_reading_at: '2026-07-21T15:00:00Z',
    })
    expect(row.tt_incidents).toEqual({ jam: 2 })
  })

  it('skips corridors outside their window', async () => {
    const db = makeDb({ contracts: [urbanContract(corridor('00:00', '00:00'))] })
    const n = await runTomTomCrossCheck(db as never, deps())
    expect(n).toBe(0)
    expect(db._insert).not.toHaveBeenCalled()
  })

  it('skips contracts with no corridor', async () => {
    const db = makeDb({ contracts: [urbanContract(null)] })
    const n = await runTomTomCrossCheck(db as never, deps())
    expect(n).toBe(0)
  })

  it('still records a row (incidents null) when the incidents call fails', async () => {
    const db = makeDb({ contracts: [urbanContract(corridor('00:00', '23:59'))], googleRows: [] })
    const n = await runTomTomCrossCheck(db as never, deps(coveredRoute, 'throw'))
    expect(n).toBe(1)
    const row = db._insert.mock.calls[0][0]
    expect(row.tt_incident_count).toBeNull()
    expect(row.tomtom_covered).toBe(true)
    expect(row.google_duration_s).toBeNull()
  })
})
