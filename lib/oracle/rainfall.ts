interface OwmRainPayload {
  rain?: { '1h'?: number; '3h'?: number }
}

export interface RainfallMetric {
  rain_1h_mm: number
  rain_3h_mm: number
}

/** Peak-intensity rainfall from an OWM current-weather payload. Absent → 0. */
export function rainfallFromOwm(data: OwmRainPayload): RainfallMetric {
  return {
    rain_1h_mm: data.rain?.['1h'] ?? 0,
    rain_3h_mm: data.rain?.['3h'] ?? 0,
  }
}
