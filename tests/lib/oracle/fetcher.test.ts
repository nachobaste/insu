import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchWeatherReading, fetchTomorrowReading, fetchGoogleMapsReading } from '@/lib/oracle/fetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('fetchWeatherReading', () => {
  beforeEach(() => mockFetch.mockReset())

  it('calls OWM current weather endpoint with lat/lng', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ main: { temp: 28.5 }, rain: { '1h': 15.3 } }),
    })
    await fetchWeatherReading(19.4, -99.1, 'test-key')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('lat=19.4'),
    )
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('lon=-99.1'),
    )
  })

  it('returns rain_mm and temp_c from OWM response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ main: { temp: 28.5 }, rain: { '1h': 15.3 } }),
    })
    const reading = await fetchWeatherReading(19.4, -99.1, 'test-key')
    expect(reading.source).toBe('openweathermap')
    expect(reading.reading_type).toBe('weather')
    expect(reading.value).toMatchObject({ rain_mm: 15.3, temp_c: 28.5 })
  })

  it('sets rain_mm = 0 when no rain field in OWM response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ main: { temp: 20 } }),
    })
    const reading = await fetchWeatherReading(19.4, -99.1, 'test-key')
    expect((reading.value as Record<string, unknown>).rain_mm).toBe(0)
  })

  it('throws when OWM returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 })
    await expect(fetchWeatherReading(19.4, -99.1, 'bad-key')).rejects.toThrow('OpenWeatherMap')
  })
})

describe('fetchTomorrowReading', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns rain_mm and temp_c from Tomorrow.io response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        data: {
          timelines: [{
            intervals: [{
              values: { precipitationIntensity: 5.2, temperature: 28.5 },
            }],
          }],
        },
      }),
    })
    const reading = await fetchTomorrowReading(19.4, -99.1, 'test-key')
    expect(reading.source).toBe('tomorrow_io')
    expect(reading.reading_type).toBe('weather')
    expect(reading.value).toMatchObject({ rain_mm: 5.2, temp_c: 28.5 })
  })

  it('throws when Tomorrow.io returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 })
    await expect(fetchTomorrowReading(19.4, -99.1, 'bad-key')).rejects.toThrow('Tomorrow.io')
  })
})

describe('fetchGoogleMapsReading', () => {
  beforeEach(() => mockFetch.mockReset())

  it('calls the Routes API with correct origin and destination', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        routes: [{ duration: '1800s', staticDuration: '1200s' }],
      }),
    })
    await fetchGoogleMapsReading(19.3983, -99.1918, 19.4147, -99.0790, 'test-key')
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes')
    const body = JSON.parse(opts.body as string)
    expect(body.origin.location.latLng.latitude).toBe(19.3983)
    expect(body.destination.location.latLng.latitude).toBe(19.4147)
    expect(body.routingPreference).toBe('TRAFFIC_AWARE')
  })

  it('computes traffic_index from duration / staticDuration', async () => {
    // 1800s actual vs 1200s free-flow → (1800/1200 - 1) * 100 = 50
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        routes: [{ duration: '1800s', staticDuration: '1200s' }],
      }),
    })
    const reading = await fetchGoogleMapsReading(19.3983, -99.1918, 19.4147, -99.0790, 'test-key')
    expect(reading.source).toBe('google_maps')
    expect(reading.reading_type).toBe('traffic')
    expect((reading.value as Record<string, unknown>).traffic_index).toBe(50)
    expect((reading.value as Record<string, unknown>).duration_s).toBe(1800)
    expect((reading.value as Record<string, unknown>).static_duration_s).toBe(1200)
  })

  it('clamps traffic_index to 100 when delay exceeds 100%', async () => {
    // 3600s actual vs 1200s free-flow → (3/1 - 1) * 100 = 200 → clamped to 100
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        routes: [{ duration: '3600s', staticDuration: '1200s' }],
      }),
    })
    const reading = await fetchGoogleMapsReading(19.3983, -99.1918, 19.4147, -99.0790, 'test-key')
    expect((reading.value as Record<string, unknown>).traffic_index).toBe(100)
  })

  it('returns traffic_index 0 when no delay', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        routes: [{ duration: '1200s', staticDuration: '1200s' }],
      }),
    })
    const reading = await fetchGoogleMapsReading(19.3983, -99.1918, 19.4147, -99.0790, 'test-key')
    expect((reading.value as Record<string, unknown>).traffic_index).toBe(0)
  })

  it('throws when Routes API returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 })
    await expect(
      fetchGoogleMapsReading(19.3983, -99.1918, 19.4147, -99.0790, 'bad-key'),
    ).rejects.toThrow('Google Maps Routes API error: 403')
  })

  it('throws when response has no routes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ routes: [] }),
    })
    await expect(
      fetchGoogleMapsReading(19.3983, -99.1918, 19.4147, -99.0790, 'test-key'),
    ).rejects.toThrow('no routes returned')
  })
})
