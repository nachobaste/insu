// lib/oracle/airQualityIndex.ts
//
// IMECA (Índice Metropolitano de la Calidad del Aire) via piecewise-linear
// interpolation. Breakpoints are [concentration_low, concentration_high,
// index_low, index_high]. VERIFY the constants against NOM-172-SEMARNAT-2019
// before production seeding — the interpolation logic is source-agnostic.

export type Breakpoint = readonly [number, number, number, number]

// PM2.5 breakpoints in µg/m³ (24h), IMECA 0–500.
export const PM25_BREAKPOINTS: readonly Breakpoint[] = [
  [0.0, 12.0, 0, 50],
  [12.1, 45.0, 51, 100],
  [45.1, 97.4, 101, 150],
  [97.5, 150.4, 151, 200],
  [150.5, 250.4, 201, 300],
  [250.5, 500.4, 301, 500],
]

// O3 breakpoints in ppb (1h), IMECA 0–500.
export const O3_PPB_BREAKPOINTS: readonly Breakpoint[] = [
  [0, 51, 0, 50],
  [52, 95, 51, 100],
  [96, 154, 101, 150],
  [155, 204, 151, 200],
  [205, 404, 201, 300],
  [405, 604, 301, 500],
]

// OWM reports O3 in µg/m³; IMECA O3 uses ppb. At 25°C / 1 atm: ppb = µg/m³ × 24.45 / MW(48).
const O3_UGM3_TO_PPB = 24.45 / 48

export function interpolateImeca(concentration: number, table: readonly Breakpoint[]): number {
  const top = table[table.length - 1]
  if (concentration >= top[1]) return top[3]
  for (const [cLow, cHigh, iLow, iHigh] of table) {
    if (concentration <= cHigh) {
      const span = cHigh - cLow
      if (span <= 0) return iLow
      const ratio = Math.max(0, (concentration - cLow) / span)
      return Math.round(iLow + ratio * (iHigh - iLow))
    }
  }
  return top[3]
}

export interface ImecaInput {
  pm25?: number      // µg/m³
  o3_ugm3?: number   // µg/m³
}

export interface ImecaResult {
  aqi_imeca: number
  pm25: number | null
  o3: number | null
}

/** Max sub-index across available pollutants. Missing pollutants are ignored. */
export function imecaFromConcentrations(input: ImecaInput): ImecaResult {
  const subIndices: number[] = []
  if (typeof input.pm25 === 'number') subIndices.push(interpolateImeca(input.pm25, PM25_BREAKPOINTS))
  if (typeof input.o3_ugm3 === 'number') {
    subIndices.push(interpolateImeca(input.o3_ugm3 * O3_UGM3_TO_PPB, O3_PPB_BREAKPOINTS))
  }
  return {
    aqi_imeca: subIndices.length ? Math.max(...subIndices) : 0,
    pm25: input.pm25 ?? null,
    o3: input.o3_ugm3 ?? null,
  }
}
