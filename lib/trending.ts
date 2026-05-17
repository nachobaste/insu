import type { ContractWithTiers } from './types'

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000

export function scoreTrending(contracts: ContractWithTiers[], limit = 4): ContractWithTiers[] {
  const now = Date.now()
  return [...contracts]
    .map((c) => {
      const age = now - new Date(c.created_at).getTime()
      const recencyWeight = age <= SIXTY_DAYS_MS ? 1.0 : 0.5
      return { contract: c, score: c.total_volume_usd * recencyWeight }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ contract }) => contract)
}
