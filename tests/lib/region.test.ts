import { describe, it, expect } from 'vitest'
import { filterByRegion } from '@/lib/region'

type Row = { id: string; location: { country: string | null } | null }

const contracts: Row[] = [
  { id: 'a', location: { country: 'MX' } },
  { id: 'b', location: { country: 'BR' } },
  { id: 'c', location: { country: null } },
  { id: 'd', location: null },
]

describe('filterByRegion', () => {
  it('MX returns only contracts whose country is MX', () => {
    expect(filterByRegion(contracts, 'MX').map((c) => c.id)).toEqual(['a'])
  })

  it('INTL returns everything that is not MX (including missing country)', () => {
    expect(filterByRegion(contracts, 'INTL').map((c) => c.id)).toEqual(['b', 'c', 'd'])
  })
})
