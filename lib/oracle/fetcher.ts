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

export async function fetchGoogleMapsReading(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  apiKey: string,
): Promise<FetchedReading> {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.duration,routes.staticDuration',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
      destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    }),
  })

  if (!res.ok) throw new Error(`Google Maps Routes API error: ${res.status}`)

  const data = await res.json()
  const route = (data.routes as Array<{ duration: string; staticDuration: string }>)?.[0]
  if (!route) throw new Error('Google Maps Routes API: no routes returned')

  const durationS = parseInt(route.duration.replace('s', ''), 10)
  const staticDurationS = parseInt(route.staticDuration.replace('s', ''), 10)

  if (!staticDurationS) throw new Error('Google Maps Routes API: zero static duration')

  const rawIndex = ((durationS / staticDurationS) - 1) * 100
  const traffic_index = Math.min(100, Math.max(0, Math.round(rawIndex)))

  return {
    source: 'google_maps',
    reading_type: 'traffic',
    value: { traffic_index, duration_s: durationS, static_duration_s: staticDurationS },
  }
}
