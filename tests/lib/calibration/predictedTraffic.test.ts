import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildDepartureGrid, samplePredictedCorridor } from '@/lib/calibration/predictedTraffic'

describe('buildDepartureGrid', () => {
  // 2026-07-09 is a Thursday -> next Monday is 2026-07-13
  const from = new Date('2026-07-09T15:00:00Z')

  it('covers Mon-Fri of the next full week at 30-min steps within the window', () => {
    const grid = buildDepartureGrid('07:00:00', '10:00:00', from)
    expect(grid).toHaveLength(30) // 6 slots x 5 weekdays
    expect(grid[0]).toEqual({
      departureTime: '2026-07-13T13:00:00Z', // 07:00 local = 13:00 UTC (fixed UTC-6)
      date: '2026-07-13',
      slot: '07:00',
    })
    expect(grid[5].slot).toBe('09:30') // last slot strictly before window_end
    expect(grid[29].date).toBe('2026-07-17') // Friday
  })

  it('handles UTC date rollover for evening windows', () => {
    const grid = buildDepartureGrid('17:00:00', '20:00:00', from)
    const slot1830 = grid.find((g) => g.date === '2026-07-13' && g.slot === '18:30')
    expect(slot1830?.departureTime).toBe('2026-07-14T00:30:00Z') // 18:30 local Monday = 00:30 UTC Tuesday
  })

  it('always starts strictly in the future even when called on a Monday', () => {
    const monday = new Date('2026-07-13T18:00:00Z')
    const grid = buildDepartureGrid('07:00:00', '10:00:00', monday)
    expect(grid[0].date).toBe('2026-07-20') // skips to the NEXT Monday
  })
})

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const corridor = {
  slug: 'test-am',
  origin_lat: 19.4487, origin_lng: -99.1374,
  dest_lat: 19.3749, dest_lng: -99.1836,
  window_start: '07:00:00', window_end: '10:00:00',
}

function respond(body: string) {
  const req = JSON.parse(body)
  let dur = 2800
  if (req.departureTime?.includes('T14:00:00Z')) dur = 3400 // 08:00 local -> peak slot
  if (req.trafficModel === 'PESSIMISTIC') dur = 6000
  if (req.trafficModel === 'OPTIMISTIC') dur = 1900
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ routes: [{ duration: `${dur}s` }] }),
  })
}

describe('samplePredictedCorridor', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockImplementation((_url: string, init: RequestInit) => respond(init.body as string))
  })

  it('samples the grid, finds the peak slot, and returns the envelope per weekday', async () => {
    const result = await samplePredictedCorridor(corridor, 'test-key', new Date('2026-07-09T15:00:00Z'))
    // 30 BEST_GUESS grid calls + 5 weekdays x (PESSIMISTIC + OPTIMISTIC) at the peak slot
    expect(mockFetch).toHaveBeenCalledTimes(40)
    expect(result.peakSlot).toBe('08:00')
    expect(result.predictedMedianS).toBe(2800) // median of 25x2800 + 5x3400
    expect(result.envelope).toHaveLength(5)
    expect(result.envelope[0]).toMatchObject({ bestS: 3400, optS: 1900, pessS: 6000 })
  })

  it('sends departureTime and TRAFFIC_AWARE for grid calls, TRAFFIC_AWARE_OPTIMAL for envelope calls', async () => {
    await samplePredictedCorridor(corridor, 'test-key', new Date('2026-07-09T15:00:00Z'))
    const bodies = mockFetch.mock.calls.map((c) => JSON.parse(c[1].body as string))
    const grid = bodies.filter((b) => !b.trafficModel)
    const envelope = bodies.filter((b) => b.trafficModel)
    expect(grid).toHaveLength(30)
    expect(grid[0].routingPreference).toBe('TRAFFIC_AWARE')
    expect(grid[0].departureTime).toBe('2026-07-13T13:00:00Z')
    expect(envelope).toHaveLength(10)
    expect(envelope[0].routingPreference).toBe('TRAFFIC_AWARE_OPTIMAL')
  })

  it('throws with the Google error body on non-ok responses', async () => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('REFERER_BLOCKED') })
    await expect(
      samplePredictedCorridor(corridor, 'bad-key', new Date('2026-07-09T15:00:00Z')),
    ).rejects.toThrow(/403.*REFERER_BLOCKED/)
  })
})
