import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchWeatherReading, fetchTomorrowReading, fetchWazeReading } from '@/lib/oracle/fetcher'

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

describe('fetchWazeReading', () => {
  it('returns a stub reading with traffic_index 0', () => {
    const reading = fetchWazeReading(19.4, -99.1)
    expect(reading.source).toBe('waze')
    expect(reading.reading_type).toBe('traffic')
    expect((reading.value as Record<string, unknown>).traffic_index).toBe(0)
  })
})
