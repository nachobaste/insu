'use client'

import { cn } from '@/lib/utils'
import { formatWindow, type CommutePeriod } from '@/lib/corridors'

export interface PeriodOption {
  period: CommutePeriod
  slug: string
  windowStart: string
}

interface Props {
  active: CommutePeriod
  options: PeriodOption[]
  onSelect: (period: CommutePeriod) => void
}

const PERIOD_LABELS: Record<CommutePeriod, string> = {
  morning: 'Morning',
  evening: 'Evening',
}

/**
 * Controlled Morning/Evening toggle for a corridor's paired protections.
 * The parent owns the active period; selecting fires `onSelect`.
 */
export function CorridorPeriodSwitch({ active, options, onSelect }: Props) {
  if (options.length < 2) return null

  const sorted = [...options].sort((a, b) =>
    a.period === 'morning' ? -1 : b.period === 'morning' ? 1 : 0,
  )

  return (
    <div className="flex items-center gap-1.5">
      {sorted.map((opt) => {
        const isActive = opt.period === active
        return (
          <button
            key={opt.period}
            type="button"
            onClick={() => onSelect(opt.period)}
            aria-current={isActive ? 'true' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-bold uppercase tracking-[0.07em] transition-colors',
              isActive
                ? 'border-category-urban/30 bg-category-urban/10 text-category-urban'
                : 'border-white/10 text-insu-muted hover:border-white/20 hover:text-insu-text',
            )}
          >
            <span>{PERIOD_LABELS[opt.period]}</span>
            <span className="font-normal normal-case tracking-normal opacity-70">
              {formatWindow(opt.windowStart)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
