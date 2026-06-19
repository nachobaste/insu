import type { ContractWithTiers, Corridor } from './types'

export type CommutePeriod = 'morning' | 'evening'

/** Morning if the corridor's window starts before noon, else evening. */
export function getContractPeriod(corridor: Corridor): CommutePeriod {
  const startHour = Number(corridor.window_start.split(':')[0])
  return startHour < 12 ? 'morning' : 'evening'
}

/** The other half of a commute pair. */
export function getSiblingPeriod(period: CommutePeriod): CommutePeriod {
  return period === 'morning' ? 'evening' : 'morning'
}

/** Format a 'HH:MM[:SS]' time as a compact label like '7am' or '5:30pm'. */
export function formatWindow(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const suffix = h < 12 ? 'am' : 'pm'
  const hour = h % 12 || 12
  return m === 0 ? `${hour}${suffix}` : `${hour}:${m.toString().padStart(2, '0')}${suffix}`
}

/** 06:00-20:00 -> evening (afternoon commute is next); otherwise -> morning. */
export function getRecommendedPeriod(now: Date = new Date()): CommutePeriod {
  const hour = now.getHours()
  return hour >= 6 && hour < 20 ? 'evening' : 'morning'
}

/** Distinct corridor road names across the given contracts, alphabetical. */
export function getUrbanRoads(contracts: ContractWithTiers[]): string[] {
  const roads = new Set<string>()
  for (const c of contracts) {
    if (c.corridor?.road) roads.add(c.corridor.road)
  }
  return [...roads].sort((a, b) => a.localeCompare(b))
}
