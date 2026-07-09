import { describe, it, expect } from 'vitest'
import { buildDepartureGrid } from '@/lib/calibration/predictedTraffic'

describe('buildDepartureGrid', () => {
  // 2026-07-09 is a Thursday -> next Monday is 2026-07-13
  const from = new Date('2026-07-09T15:00:00Z')

  it('covers Mon-Fri of the next full week at 30-min steps within the window', () => {
    const grid = buildDepartureGrid('07:00:00', '10:00:00', from)
    expect(grid).toHaveLength(30) // 6 slots x 5 weekdays
    expect(grid[0]).toEqual({
      departureTime: '2026-07-13T13:00:00Z', // 07:00 local = 13:00 UTC (fixed UTC-6)
      date: '2026-07-13',
      slot: '07:00',
    })
    expect(grid[5].slot).toBe('09:30') // last slot strictly before window_end
    expect(grid[29].date).toBe('2026-07-17') // Friday
  })

  it('handles UTC date rollover for evening windows', () => {
    const grid = buildDepartureGrid('17:00:00', '20:00:00', from)
    const slot1830 = grid.find((g) => g.date === '2026-07-13' && g.slot === '18:30')
    expect(slot1830?.departureTime).toBe('2026-07-14T00:30:00Z') // 18:30 local Monday = 00:30 UTC Tuesday
  })

  it('always starts strictly in the future even when called on a Monday', () => {
    const monday = new Date('2026-07-13T18:00:00Z')
    const grid = buildDepartureGrid('07:00:00', '10:00:00', monday)
    expect(grid[0].date).toBe('2026-07-20') // skips to the NEXT Monday
  })
})
