import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const sampleResult = { predictedMedianS: 2856, peakSlot: '08:00', samples: [], envelope: [] }
const mockSample = vi.fn()
const mockMaybeSingle = vi.fn()

vi.mock('@/lib/calibration/predictedTraffic', () => ({
  samplePredictedCorridor: (...args: unknown[]) => mockSample(...args),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
  }),
}))

import { GET } from '@/app/api/calibrate/route'

function request(url: string, auth?: string) {
  return new NextRequest(url, { headers: auth ? { authorization: auth } : {} })
}

describe('GET /api/calibrate', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test-secret')
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'server-key')
    mockSample.mockReset().mockResolvedValue(sampleResult)
    mockMaybeSingle.mockReset().mockResolvedValue({
      data: {
        slug: 'gt-cesa-zona10-pm',
        origin_lat: 14.58, origin_lng: -90.49, dest_lat: 14.55, dest_lng: -90.45,
        window_start: '17:00:00', window_end: '20:00:00',
      },
      error: null,
    })
  })

  it('rejects requests without the cron secret', async () => {
    const res = await GET(request('http://x/api/calibrate?corridor=gt-cesa-zona10-pm'))
    expect(res.status).toBe(401)
  })

  it('requires a corridor param', async () => {
    const res = await GET(request('http://x/api/calibrate', 'Bearer test-secret'))
    expect(res.status).toBe(400)
  })

  it('404s on an unknown corridor', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    const res = await GET(request('http://x/api/calibrate?corridor=nope', 'Bearer test-secret'))
    expect(res.status).toBe(404)
  })

  it('returns the prediction sample for a known corridor', async () => {
    const res = await GET(request('http://x/api/calibrate?corridor=gt-cesa-zona10-pm', 'Bearer test-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(sampleResult)
    expect(mockSample).toHaveBeenCalledWith(expect.objectContaining({ slug: 'gt-cesa-zona10-pm' }), 'server-key')
  })

  it('returns 502 with the message when sampling fails', async () => {
    mockSample.mockRejectedValue(new Error('Google Maps Routes API error: 429'))
    const res = await GET(request('http://x/api/calibrate?corridor=gt-cesa-zona10-pm', 'Bearer test-secret'))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/429/)
  })
})
