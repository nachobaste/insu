import Link from 'next/link'
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
}

const PERIOD_LABELS: Record<CommutePeriod, string> = {
  morning: 'Morning',
  evening: 'Evening',
}

/**
 * Lets a corridor detail page switch between its paired morning/evening
 * protections. Each inactive period links to its sibling contract's market.
 */
export function CorridorPeriodSwitch({ active, options }: Props) {
  if (options.length < 2) return null

  const sorted = [...options].sort((a, b) =>
    a.period === 'morning' ? -1 : b.period === 'morning' ? 1 : 0,
  )

  return (
    <div className="flex items-center gap-1.5">
      {sorted.map((opt) => {
        const isActive = opt.period === active
        const className = cn(
          'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.07em] transition-colors',
          isActive
            ? 'border-category-urban/30 bg-category-urban/10 text-category-urban'
            : 'border-white/10 text-insu-muted hover:border-white/20 hover:text-insu-text',
        )
        const content = (
          <>
            <span>{PERIOD_LABELS[opt.period]}</span>
            <span className="font-normal normal-case tracking-normal opacity-70">
              {formatWindow(opt.windowStart)}
            </span>
          </>
        )
        return isActive ? (
          <span key={opt.period} className={className} aria-current="true">
            {content}
          </span>
        ) : (
          <Link key={opt.period} href={`/markets/${opt.slug}`} className={className}>
            {content}
          </Link>
        )
      })}
    </div>
  )
}
