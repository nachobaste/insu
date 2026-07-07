import { getContractPeriod, getRecommendedPeriod } from './corridors'
import type { ContractWithTiers } from './types'

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000

/**
 * One card per corridor road: both periods of a pair open the same market page
 * (with the AM/PM toggle), so trending keeps only the period a commuter would
 * buy right now — the same recommendation the corridor pair cards highlight.
 */
function dedupeCorridorPairs(contracts: ContractWithTiers[]): ContractWithTiers[] {
  const recommended = getRecommendedPeriod()
  const keptByRoad = new Map<string, number>() // road -> index in result
  const result: ContractWithTiers[] = []

  for (const contract of contracts) {
    const road = contract.corridor?.road
    if (!road) {
      result.push(contract)
      continue
    }
    const keptIndex = keptByRoad.get(road)
    if (keptIndex === undefined) {
      keptByRoad.set(road, result.length)
      result.push(contract)
    } else if (
      contract.corridor && getContractPeriod(contract.corridor) === recommended
    ) {
      result[keptIndex] = contract
    }
  }

  return result
}

export function scoreTrending(contracts: ContractWithTiers[], limit = 4): ContractWithTiers[] {
  const now = Date.now()
  return dedupeCorridorPairs(contracts)
    .map((c) => {
      const age = now - new Date(c.created_at).getTime()
      const recencyWeight = age <= SIXTY_DAYS_MS ? 1.0 : 0.5
      return { contract: c, score: c.total_volume_usd * recencyWeight }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ contract }) => contract)
}
