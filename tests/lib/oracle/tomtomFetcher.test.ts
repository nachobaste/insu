import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchTomTomRoute } from '@/lib/oracle/tomtomFetcher'
import { fetchTomTomIncidents } from '@/lib/oracle/tomtomFetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const routeSummary = {
  travelTimeInSeconds: 1712,
  noTrafficTravelTimeInSeconds: 1572,
  historicTrafficTravelTimeInSeconds: 1600,
  trafficDelayInSeconds: 40,
}

describe('fetchTomTomRoute', () => {
  beforeEach(() => mockFetch.mockReset())

  it('calls calculateRoute with origin:dest and computeTravelTimeFor=all', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ routes: [{ summary: routeSummary }] }) })
    await fetchTomTomRoute(19.41, -99.20, 19.47, -99.17, 'k')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/routing/1/calculateRoute/19.41,-99.2:19.47,-99.17/json')
    expect(url).toContain('computeTravelTimeFor=all')
    expect(url).toContain('key=k')
  })

  it('normalizes the summary and computes both indices', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ routes: [{ summary: routeSummary }] }) })
    const r = await fetchTomTomRoute(19.41, -99.20, 19.47, -99.17, 'k')
    expect(r.covered).toBe(true)
    expect(r.liveS).toBe(1712)
    expect(r.freeFlowS).toBe(1572)
    expect(r.historicS).toBe(1600)
    expect(r.delayS).toBe(40)
    expect(r.indexVsHistoric).toBe(7)
    expect(r.indexVsFreeFlow).toBe(9)
  })

  it('returns covered=false with null fields when no route present', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ routes: [] }) })
    const r = await fetchTomTomRoute(19.41, -99.20, 19.47, -99.17, 'k')
    expect(r.covered).toBe(false)
    expect(r.liveS).toBeNull()
    expect(r.indexVsHistoric).toBeNull()
  })

  it('throws on non-ok HTTP status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 })
    await expect(fetchTomTomRoute(19.41, -99.20, 19.47, -99.17, 'k')).rejects.toThrow('403')
  })
})

describe('fetchTomTomIncidents', () => {
  beforeEach(() => mockFetch.mockReset())

  const bbox = { minLon: -99.2, minLat: 19.41, maxLon: -99.17, maxLat: 19.47 }

  it('sends the bbox and present filter', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ incidents: [] }) })
    await fetchTomTomIncidents(bbox, 'k')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/traffic/services/5/incidentDetails')
    expect(url).toContain('bbox=-99.2%2C19.41%2C-99.17%2C19.47')
    expect(url).toContain('timeValidityFilter=present')
  })

  it('counts incidents, breaks down by category, and takes max magnitude', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ incidents: [
      { properties: { iconCategory: 6, magnitudeOfDelay: 1 } },
      { properties: { iconCategory: 6, magnitudeOfDelay: 3 } },
      { properties: { iconCategory: 8, magnitudeOfDelay: 4 } },
    ] }) })
    const r = await fetchTomTomIncidents(bbox, 'k')
    expect(r.count).toBe(3)
    expect(r.byCategory).toEqual({ jam: 2, road_closed: 1 })
    expect(r.maxMagnitude).toBe(4)
  })

  it('returns zero-count with empty breakdown when no incidents', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ incidents: [] }) })
    const r = await fetchTomTomIncidents(bbox, 'k')
    expect(r.count).toBe(0)
    expect(r.byCategory).toEqual({})
    expect(r.maxMagnitude).toBeNull()
  })

  it('throws on non-ok HTTP status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 })
    await expect(fetchTomTomIncidents(bbox, 'k')).rejects.toThrow('429')
  })
})
