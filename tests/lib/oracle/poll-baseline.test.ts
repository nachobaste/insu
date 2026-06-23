import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Contract } from '@/lib/types'

// Mock the fetcher module so we can assert how defaultFetcher calls the Google
// reader. (The main poll.test.ts injects its own fetcher and never exercises
// defaultFetcher's wiring, which is what we verify here.)
vi.mock('@/lib/oracle/fetcher', () => ({
  fetchGoogleMapsReading: vi.fn().mockResolvedValue({
    source: 'google_maps', reading_type: 'traffic', value: { traffic_index: 0 },
  }),
  fetchWeatherReading: vi.fn(),
  fetchTomorrowReading: vi.fn(),
}))

import { pollContracts } from '@/lib/oracle/poll'
import { fetchGoogleMapsReading } from '@/lib/oracle/fetcher'

function chainable(value: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is']) b[m] = vi.fn().mockReturnValue(b)
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(value).then(res)
  return b
}

function makeDb(contracts: Contract[]) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'contracts') return chainable({ data: contracts, error: null })
      if (table === 'oracle_readings') return { insert: vi.fn().mockResolvedValue({ error: null }) }
      return {}
    }),
  }
}

const urbanContract = {
  id: 'u1', slug: 'viaducto-am', title: 'Viaducto AM', description: null, category_id: 'c',
  status: 'active', trigger_type: 'urban',
  trigger_condition: { metric: 'traffic_index', threshold: 50, operator: 'gt' },
  trigger_deadline: new Date(Date.now() + 7 * 864e5).toISOString(), is_recurring: false,
  location: { lat: 19.4, lng: -99.1, city: 'CDMX', country: 'MX' }, icon_url: null,
  total_volume_usd: 0, total_volume_mxn: 0, is_featured: false, settled_outcome: null,
  created_by: 'admin', created_at: '', settled_at: null,
  corridor: {
    id: 'cor1', slug: 'viaducto-am', name: 'Viaducto AM', road: 'Viaducto',
    origin_lat: 19.3983, origin_lng: -99.1918, dest_lat: 19.4147, dest_lng: -99.0790,
    window_start: '07:00:00', window_end: '10:00:00', baseline_duration_s: 1234, created_at: '',
  },
} as unknown as Contract

describe('pollContracts urban baseline wiring', () => {
  beforeEach(() => {
    vi.mocked(fetchGoogleMapsReading).mockClear()
    process.env.GOOGLE_MAPS_API_KEY = 'test-key'
    // 14:00Z = 08:00 Mexico City (UTC-6) → inside 07:00–10:00 window
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T14:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    delete process.env.GOOGLE_MAPS_API_KEY
  })

  it("passes the corridor's baseline_duration_s to fetchGoogleMapsReading", async () => {
    const db = makeDb([urbanContract])
    await pollContracts(db as never)
    expect(fetchGoogleMapsReading).toHaveBeenCalledWith(
      19.3983, -99.1918, 19.4147, -99.0790, 'test-key', 1234,
    )
  })
})
