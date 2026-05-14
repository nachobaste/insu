import type { OracleReading } from '@/lib/types'

type FetchedReading = Pick<OracleReading, 'source' | 'reading_type' | 'value'>

export async function fetchWeatherReading(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<FetchedReading> {
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OpenWeatherMap error: ${res.status}`)
  const data = await res.json()
  return {
    source: 'openweathermap',
    reading_type: 'weather',
    value: {
      rain_mm: (data.rain?.['1h'] as number) ?? 0,
      temp_c: data.main?.temp as number,
      raw: data,
    },
  }
}

export async function fetchTomorrowReading(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<FetchedReading> {
  const url = `https://api.tomorrow.io/v4/timelines?location=${lat},${lng}&fields=precipitationIntensity,temperature&timesteps=1h&apikey=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Tomorrow.io error: ${res.status}`)
  const data = await res.json()
  const values = data?.data?.timelines?.[0]?.intervals?.[0]?.values ?? {}
  return {
    source: 'tomorrow_io',
    reading_type: 'weather',
    value: {
      rain_mm: (values.precipitationIntensity as number) ?? 0,
      temp_c: (values.temperature as number) ?? 0,
      raw: data,
    },
  }
}

export function fetchWazeReading(lat: number, lng: number): FetchedReading {
  // Waze has no public API. Returns stub — urban contracts use admin manual override.
  void lat; void lng
  return {
    source: 'waze',
    reading_type: 'traffic',
    value: { traffic_index: 0 },
  }
}
