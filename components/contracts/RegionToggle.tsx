'use client'

import { cn } from '@/lib/utils'
import type { Region } from '@/lib/region'

interface Props {
  region: Region
  onSelect: (region: Region) => void
}

const OPTIONS: { value: Region; label: string; flag: string }[] = [
  { value: 'MX', label: 'Mexico', flag: '🇲🇽' },
  { value: 'INTL', label: 'International', flag: '🌎' },
]

/**
 * Region switch for the browse page. Defaults to Mexico (the demo focus); the
 * visible "International" option signals that international markets exist.
 */
export default function RegionToggle({ region, onSelect }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Region"
      className="inline-flex items-center gap-1 rounded-lg border border-white/[0.07] bg-bg-card p-1"
    >
      {OPTIONS.map((o) => {
        const active = o.value === region
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(o.value)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors',
              active ? 'bg-insu-accent text-bg' : 'text-insu-muted hover:text-insu-text',
            )}
          >
            <span aria-hidden="true">{o.flag}</span>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
