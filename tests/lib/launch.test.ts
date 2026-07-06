import { describe, it, expect } from 'vitest'
import { partitionByLaunchStage, groupLiveContracts } from '@/lib/launch'
import type { ContractWithTiers } from '@/lib/types'

function makeContract(overrides: Record<string, unknown>): ContractWithTiers {
  return {
    id: crypto.randomUUID(),
    slug: 's',
    title: 't',
    trigger_type: 'urban',
    launch_stage: 'live',
    location: { city: 'Mexico City', country: 'MX' },
    corridor: null,
    coverage_tiers: [],
    category: { id: '1', slug: 'urban', name: 'Urban', color: '#fff', display_order: 1, icon_url: null },
    ...overrides,
  } as unknown as ContractWithTiers
}

describe('partitionByLaunchStage', () => {
  it('splits live vs coming_soon, defaulting missing stage to live', () => {
    const live = makeContract({})
    const soon = makeContract({ launch_stage: 'coming_soon' })
    const legacy = makeContract({ launch_stage: undefined })
    const result = partitionByLaunchStage([live, soon, legacy])
    expect(result.live).toEqual([live, legacy])
    expect(result.comingSoon).toEqual([soon])
  })
})

describe('groupLiveContracts', () => {
  it('groups traffic per city (Mexico City first), then gas, then flood/air', () => {
    const cdmx = makeContract({ trigger_type: 'urban', corridor: { id: 'c1', road: 'Reforma' } })
    const guate = makeContract({
      trigger_type: 'urban',
      corridor: { id: 'c2', road: 'CA-1' },
      location: { city: 'Guatemala City', country: 'GT' },
    })
    const gas = makeContract({ trigger_type: 'fuel', corridor: null })
    const flood = makeContract({ trigger_type: 'flood', corridor: null })
    const air = makeContract({ trigger_type: 'air_quality', corridor: null })

    const groups = groupLiveContracts([guate, gas, flood, air, cdmx])
    expect(groups.map((g) => g.key)).toEqual([
      'traffic-Mexico City', 'traffic-Guatemala City', 'gas', 'air-flood',
    ])
    expect(groups[0].contracts).toEqual([cdmx])
    expect(groups[1].contracts).toEqual([guate])
    expect(groups[2].contracts).toEqual([gas])
    expect(groups[3].contracts).toEqual([flood, air])
  })

  it('puts unmatched live contracts in a trailing group instead of dropping them', () => {
    const other = makeContract({ trigger_type: 'weather', corridor: null })
    const groups = groupLiveContracts([other])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('more')
    expect(groups[0].contracts).toEqual([other])
  })

  it('omits empty groups', () => {
    expect(groupLiveContracts([])).toEqual([])
  })
})
