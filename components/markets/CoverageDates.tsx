import { cn } from '@/lib/utils'
import type { Corridor } from '@/lib/types'
import {
  coveredWindowDays,
  formatCoveredWindows,
  formatCoverageRange,
} from '@/lib/utils/coverageWindow'

interface Props {
  /** Corridor contracts get window-aware dates; others a plain start–end range. */
  corridor?: Pick<Corridor, 'window_start' | 'window_end'> | null
  /** Coverage start — purchase time (or now, when previewing a quote). */
  start: Date | string
  periodDays: number
  className?: string
}

export default function CoverageDates({ corridor, start, periodDays, className }: Props) {
  const label = corridor
    ? formatCoveredWindows(
        coveredWindowDays(start, periodDays, corridor.window_start, corridor.window_end),
        corridor.window_start,
        corridor.window_end,
      )
    : formatCoverageRange(start, periodDays)

  if (!label) return null

  return (
    <p className={cn('text-[12px] leading-relaxed text-insu-muted', className)}>
      Covers <span className="font-semibold text-insu-text">{label}</span>
    </p>
  )
}
