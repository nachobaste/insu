export type Region = 'MX' | 'INTL'

type HasLocation = { location?: { country?: string | null } | null }

/** Mexico contracts are the demo focus; everything else is "International". */
export function isMexico(contract: HasLocation): boolean {
  return contract.location?.country === 'MX'
}

export function filterByRegion<T extends HasLocation>(contracts: T[], region: Region): T[] {
  return contracts.filter((c) => (region === 'MX' ? isMexico(c) : !isMexico(c)))
}
