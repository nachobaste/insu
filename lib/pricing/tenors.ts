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

/**
 * The subset of PERIOD_OPTIONS whose premium stays under the cap for daily
 * hazard `p`. The 1-day option is always offered (it never caps at realistic
 * hazards, and a corridor with no buyable period would be a dead listing).
 */
export function availablePeriods(p: number): PeriodOption[] {
  const options = PERIOD_OPTIONS.filter((o) => tenorAvailable(o.days, p))
  return options.length > 0 ? options : [PERIOD_OPTIONS[0]]
}
