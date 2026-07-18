import { describe, it, expect } from 'vitest'
import { aggregateDailyOracleSeries, metricLabel } from '@/lib/oracle/dailySeries'

// Market tz is UTC-6, so local HH:00 == UTC (HH+6):00.
// Window 07:00–10:00 local == 13:00–16:00 UTC.
const WINDOW = { start: '07:00:00', end: '10:00:00' }

const reading = (readAtUtc: string, traffic_index: number) => ({
  read_at: readAtUtc,
  value: { traffic_index },
})

describe('aggregateDailyOracleSeries', () => {
  it('returns the in-window max per market-local day', () => {
    const readings = [
      reading('2026-07-10T13:00:00Z', 40), // 07:00 local — in window
      reading('2026-07-10T14:00:00Z', 57), // 08:00 local — in window (max)
      reading('2026-07-10T15:00:00Z', 48), // 09:00 local — in window
    ]
    expect(aggregateDailyOracleSeries(readings, 'traffic_index', WINDOW)).toEqual([
      { date: '2026-07-10', value: 57 },
    ])
  })

  it('excludes out-of-window readings', () => {
    const readings = [
      reading('2026-07-10T14:00:00Z', 30), // 08:00 local — in window
      reading('2026-07-10T20:00:00Z', 99), // 14:00 local — OUT of window
    ]
    expect(aggregateDailyOracleSeries(readings, 'traffic_index', WINDOW)).toEqual([
      { date: '2026-07-10', value: 30 },
    ])
  })

  it('with no window, takes the daily max across all readings', () => {
    const readings = [
      reading('2026-07-10T02:00:00Z', 12),
      reading('2026-07-10T20:00:00Z', 88),
    ]
    expect(aggregateDailyOracleSeries(readings, 'aqi', null)).toEqual([])
    const aqi = [
      { read_at: '2026-07-10T02:00:00Z', value: { aqi: 12 } },
      { read_at: '2026-07-10T20:00:00Z', value: { aqi: 88 } },
    ]
    expect(aggregateDailyOracleSeries(aqi, 'aqi', null)).toEqual([
      { date: '2026-07-10', value: 88 },
    ])
  })

  it('skips readings whose metric value is missing or non-numeric', () => {
    const readings = [
      { read_at: '2026-07-10T14:00:00Z', value: { traffic_index: 'n/a' } },
      { read_at: '2026-07-10T14:15:00Z', value: {} },
      reading('2026-07-10T14:30:00Z', 45),
    ]
    expect(aggregateDailyOracleSeries(readings, 'traffic_index', WINDOW)).toEqual([
      { date: '2026-07-10', value: 45 },
    ])
  })

  it('sorts multiple days ascending', () => {
    const readings = [
      reading('2026-07-11T14:00:00Z', 60),
      reading('2026-07-10T14:00:00Z', 50),
    ]
    expect(aggregateDailyOracleSeries(readings, 'traffic_index', WINDOW)).toEqual([
      { date: '2026-07-10', value: 50 },
      { date: '2026-07-11', value: 60 },
    ])
  })

  it('returns [] for empty input', () => {
    expect(aggregateDailyOracleSeries([], 'traffic_index', WINDOW)).toEqual([])
  })

  it('includes a reading exactly at the window START (07:00 local = 13:00Z)', () => {
    // [start, end) — the start boundary is inclusive
    const readings = [reading('2026-07-10T13:00:00Z', 55)] // exactly 07:00 local
    expect(aggregateDailyOracleSeries(readings, 'traffic_index', WINDOW)).toEqual([
      { date: '2026-07-10', value: 55 },
    ])
  })

  it('excludes a reading exactly at the window END (10:00 local = 16:00Z)', () => {
    // [start, end) — the end boundary is exclusive
    const readings = [
      reading('2026-07-10T14:00:00Z', 40), // 08:00 local — in window
      reading('2026-07-10T16:00:00Z', 99), // exactly 10:00 local — excluded
    ]
    expect(aggregateDailyOracleSeries(readings, 'traffic_index', WINDOW)).toEqual([
      { date: '2026-07-10', value: 40 },
    ])
  })
})

describe('metricLabel', () => {
  it('maps known metrics', () => {
    expect(metricLabel('traffic_index')).toBe('Traffic index')
    expect(metricLabel('aqi')).toBe('Air quality')
  })
  it('de-underscores unknown metrics', () => {
    expect(metricLabel('some_new_metric')).toBe('some new metric')
  })
})
