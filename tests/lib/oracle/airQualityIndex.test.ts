import { describe, it, expect } from 'vitest'
import { imecaFromConcentrations, interpolateImeca, PM25_BREAKPOINTS } from '@/lib/oracle/airQualityIndex'

describe('interpolateImeca', () => {
  it('returns the low index bound at the low concentration bound', () => {
    // PM2.5 first segment: 0.0–12.0 µg/m³ maps to IMECA 0–50
    expect(interpolateImeca(0, PM25_BREAKPOINTS)).toBe(0)
  })

  it('interpolates linearly at a segment midpoint', () => {
    // midpoint of 0.0–12.0 µg/m³ (=6.0) → midpoint of IMECA 0–50 (=25)
    expect(interpolateImeca(6.0, PM25_BREAKPOINTS)).toBe(25)
  })

  it('clamps concentrations above the top breakpoint to the max index', () => {
    expect(interpolateImeca(100000, PM25_BREAKPOINTS)).toBe(500)
  })
})

describe('imecaFromConcentrations', () => {
  it('takes the max sub-index across O3 and PM2.5', () => {
    // Clean PM2.5, ozone-heavy → ozone drives the index above PM2.5's
    const out = imecaFromConcentrations({ pm25: 6.0, o3_ugm3: 300 })
    expect(out.aqi_imeca).toBeGreaterThan(interpolateImeca(6.0, PM25_BREAKPOINTS))
    expect(out.pm25).toBe(6.0)
    expect(out.o3).toBe(300)
  })

  it('handles a missing pollutant by ignoring it', () => {
    const out = imecaFromConcentrations({ pm25: 6.0 })
    expect(out.aqi_imeca).toBe(25)
  })
})
