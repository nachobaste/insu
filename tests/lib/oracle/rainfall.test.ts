import { describe, it, expect } from 'vitest'
import { rainfallFromOwm } from '@/lib/oracle/rainfall'

describe('rainfallFromOwm', () => {
  it('extracts 1h and 3h rain from an OWM current-weather payload', () => {
    const out = rainfallFromOwm({ rain: { '1h': 34.2, '3h': 51.0 } })
    expect(out).toEqual({ rain_1h_mm: 34.2, rain_3h_mm: 51.0 })
  })

  it('treats a missing rain field as zero', () => {
    expect(rainfallFromOwm({})).toEqual({ rain_1h_mm: 0, rain_3h_mm: 0 })
  })

  it('treats a partial rain field (only 1h) with 3h defaulting to zero', () => {
    expect(rainfallFromOwm({ rain: { '1h': 12 } })).toEqual({ rain_1h_mm: 12, rain_3h_mm: 0 })
  })
})
