import type { OracleReading } from '@/lib/types'
import { trafficIndex } from './trafficIndex'
import { rainfallFromOwm } from './rainfall'
import { imecaFromConcentrations } from './airQualityIndex'

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

export async function fetchFloodReading(
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
    reading_type: 'flood',
    value: { ...rainfallFromOwm(data) },
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
  baselineDurationS: number | null = null,
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

  if (!res.ok) {
    // Include Google's error body — it carries the actionable reason
    // (e.g. API_KEY_HTTP_REFERRER_BLOCKED, API_KEY_SERVICE_BLOCKED) that a
    // bare status code hides.
    const body = await res.text().catch(() => '')
    throw new Error(`Google Maps Routes API error: ${res.status} ${body}`.trim())
  }

  const data = await res.json()
  const route = (data.routes as Array<{ duration: string; staticDuration: string }>)?.[0]
  if (!route) throw new Error('Google Maps Routes API: no routes returned')

  const durationS = parseInt(route.duration.replace('s', ''), 10)
  const staticDurationS = parseInt(route.staticDuration.replace('s', ''), 10)
  if (!staticDurationS) throw new Error('Google Maps Routes API: zero static duration')

  // Measure against the corridor's TYPICAL in-window duration so we trigger on
  // extraordinary traffic, not predictable rush hour. Fall back to free-flow
  // (legacy behavior) until a baseline has been computed from history.
  const baselineS = baselineDurationS && baselineDurationS > 0 ? baselineDurationS : staticDurationS
  const traffic_index = trafficIndex(durationS, baselineS)

  return {
    source: 'google_maps',
    reading_type: 'traffic',
    value: { traffic_index, duration_s: durationS, static_duration_s: staticDurationS, baseline_duration_s: baselineS },
  }
}

export async function fetchAirQualityReading(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<FetchedReading> {
  const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lng}&appid=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OpenWeatherMap error: ${res.status}`)
  const data = await res.json()
  const c = (data.list?.[0]?.components ?? {}) as { pm2_5?: number; o3?: number }
  const index = imecaFromConcentrations({ pm25: c.pm2_5, o3_ugm3: c.o3 })
  return {
    source: 'openweathermap',
    reading_type: 'air_quality',
    value: { ...index, source_detail: 'owm' },
  }
}

/**
 * Fetch the encoded road-route polyline for a corridor. Road geometry is static,
 * so this is captured once and stored on the corridor (corridors.path_polyline)
 * for the contract map to draw — separate from the per-poll traffic reading.
 */
export async function fetchCorridorPolyline(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  apiKey: string,
): Promise<string> {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
      destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google Maps Routes API error: ${res.status} ${body}`.trim())
  }

  const data = await res.json()
  const encoded = (data.routes as Array<{ polyline?: { encodedPolyline?: string } }>)?.[0]?.polyline?.encodedPolyline
  if (!encoded) throw new Error('Google Maps Routes API: no polyline returned')
  return encoded
}
