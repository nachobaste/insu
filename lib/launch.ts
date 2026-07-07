import type { ContractWithTiers } from './types'

/** One browse-page section of live products. `categorySlug` reuses the
 *  existing category color styling in ContractSection. */
export interface ProductGroup {
  key: string
  title: string
  categorySlug: string
  icon: string
  description: string
  contracts: ContractWithTiers[]
}

/** Missing/unknown stage counts as live so pre-migration rows keep working. */
export function partitionByLaunchStage<T extends { launch_stage?: string }>(
  contracts: T[],
): { live: T[]; comingSoon: T[] } {
  const live: T[] = []
  const comingSoon: T[] = []
  for (const c of contracts) {
    if (c.launch_stage === 'coming_soon') comingSoon.push(c)
    else live.push(c)
  }
  return { live, comingSoon }
}

/** Order live products the way a new user should read them:
 *  traffic per city (home market first), then gas, then flood & air. */
export function groupLiveContracts(live: ContractWithTiers[]): ProductGroup[] {
  const groups: ProductGroup[] = []

  const traffic = live.filter((c) => c.trigger_type === 'urban' && c.corridor)
  const cities = [...new Set(traffic.map((c) => c.location?.city ?? 'Other'))].sort(
    (a, b) => (a === 'Mexico City' ? -1 : b === 'Mexico City' ? 1 : a.localeCompare(b)),
  )
  for (const city of cities) {
    groups.push({
      key: `traffic-${city}`,
      title: `Traffic protection — ${city}`,
      categorySlug: 'urban',
      icon: '🚗',
      description: 'Rush-hour delay coverage · Pays when your trip runs far over typical',
      contracts: traffic.filter((c) => (c.location?.city ?? 'Other') === city),
    })
  }

  const gas = live.filter((c) => c.trigger_type === 'fuel')
  if (gas.length > 0) {
    groups.push({
      key: 'gas',
      title: 'Gas prices',
      categorySlug: 'experiences',
      icon: '⛽',
      description: 'Pump-price protection · Pays when fuel spikes',
      contracts: gas,
    })
  }

  const airFlood = live.filter(
    (c) => c.trigger_type === 'flood' || c.trigger_type === 'air_quality',
  )
  if (airFlood.length > 0) {
    groups.push({
      key: 'air-flood',
      title: 'Flood & Air quality',
      categorySlug: 'nature',
      icon: '🌧️',
      description: 'Heavy rain · Air-quality contingency',
      contracts: airFlood,
    })
  }

  const placed = new Set(groups.flatMap((g) => g.contracts.map((c) => c.id)))
  const rest = live.filter((c) => !placed.has(c.id))
  if (rest.length > 0) {
    groups.push({
      key: 'more',
      title: 'More coverage',
      categorySlug: 'urban',
      icon: '🛡️',
      description: 'Other live products',
      contracts: rest,
    })
  }

  return groups
}
