import { tenorAvailable } from '@/lib/pricing/derivative'

export interface PeriodOption {
  days: number
  label: string
}

/** Candidate protection periods offered on recurring contracts. */
export const PERIOD_OPTIONS: readonly PeriodOption[] = [
  { days: 1, label: '1 day' },
  { days: 3, label: '3 days' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
] as const

/** Protection periods offered on fuel contracts (weekly-updating price → no sub-week bets). */
export const FUEL_PERIOD_OPTIONS: readonly PeriodOption[] = [
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
] as const

/** The candidate period menu for a contract: fuel gets {7,14,30}, everything else the global menu. */
export function periodMenuForContract(contract: { trigger_type: string }): readonly PeriodOption[] {
  return contract.trigger_type === 'fuel' ? FUEL_PERIOD_OPTIONS : PERIOD_OPTIONS
}

/**
 * The subset of `menu` whose premium stays under the cap for daily hazard `p`.
 * The first menu option is always offered (a corridor with no buyable period
 * would be a dead listing).
 */
export function availablePeriods(
  p: number,
  menu: readonly PeriodOption[] = PERIOD_OPTIONS,
): PeriodOption[] {
  const options = menu.filter((o) => tenorAvailable(o.days, p))
  return options.length > 0 ? options : [menu[0]]
}
