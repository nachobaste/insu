'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { cn, formatVolume, countryFlag } from '@/lib/utils'
import { getRecommendedPeriod, formatWindow, type CommutePeriod } from '@/lib/corridors'
import type { ContractWithTiers, CoverageLevel } from '@/lib/types'
import type { DisplayMode } from '@/lib/currency/config'
import { displayPrice } from '@/lib/currency/resolve'

const TIER_LABELS: Record<CoverageLevel, string> = {
  basic:   'Basic protection',
  premium: 'Pro protection',
}

interface Props {
  morning: ContractWithTiers | null
  evening: ContractWithTiers | null
  displayMode: DisplayMode
}

function stripPeriodSuffix(title: string): string {
  const idx = title.indexOf(' — Protección')
  return idx >= 0 ? title.slice(0, idx) : title
}

const emptySubscribe = () => () => {}

export default function CorridorPairCard({ morning, evening, displayMode }: Props) {
  const router = useRouter()

  const hasBoth = morning !== null && evening !== null

  // false during SSR/hydration, true after mount — recommendedPeriod depends on
  // new Date(), so it must stay null until the client renders (avoids hydration
  // mismatch)
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)
  const recommendedPeriod = useMemo<CommutePeriod | null>(
    () => (mounted ? getRecommendedPeriod() : null),
    [mounted]
  )
  const [selectedPeriod, setSelectedPeriod] = useState<CommutePeriod | null>(null)
  const activePeriod: CommutePeriod =
    selectedPeriod ??
    (hasBoth && recommendedPeriod !== null ? recommendedPeriod : morning ? 'morning' : 'evening')

  const active = activePeriod === 'morning' ? morning : evening
  if (!active) return null

  const tiers = [...active.coverage_tiers].sort((a, b) =>
    a.name === 'basic' ? -1 : b.name === 'basic' ? 1 : 0
  )

  const isRecommended = recommendedPeriod !== null && activePeriod === recommendedPeriod
  const recommendedOnOther = recommendedPeriod !== null && activePeriod !== recommendedPeriod

  function handleToggle(e: React.MouseEvent, period: CommutePeriod) {
    e.stopPropagation()
    setSelectedPeriod(period)
  }

  const morningTime = morning?.corridor ? formatWindow(morning.corridor.window_start) : null
  const eveningTime = evening?.corridor ? formatWindow(evening.corridor.window_start) : null

  return (
    <article
      onClick={() => router.push(`/markets/${active.slug}`)}
      className={cn(
        'relative cursor-pointer overflow-hidden rounded-card border border-white/[0.07] bg-bg-card p-[18px]',
        'transition-all duration-200 hover:-translate-y-0.5 hover:bg-bg-card-hover hover:border-white/15',
        'before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:rounded-t-card before:bg-category-urban',
        'card-fadein'
      )}
    >
      {isRecommended && (
        <span className="absolute right-3.5 top-3.5 rounded px-[7px] py-[3px] text-[10px] font-bold uppercase tracking-[0.1em] bg-blue-400/15 text-blue-400 border border-blue-400/25">
          recommended
        </span>
      )}

      {/* Icon */}
      <div className="mb-3 flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-category-urban/10 text-lg">
        {active.icon_url ? (
          active.icon_url.startsWith('http') || active.icon_url.startsWith('/') ? (
            <Image src={active.icon_url} alt="" width={20} height={20} />
          ) : (
            <span aria-hidden="true" className="text-base leading-none">{active.icon_url}</span>
          )
        ) : (
          <span aria-hidden="true">◆</span>
        )}
      </div>

      {/* Title */}
      <p className="mb-1.5 text-[13.5px] font-semibold leading-[1.45] text-insu-text">
        {stripPeriodSuffix(active.title)}
      </p>

      {/* Location */}
      <p className="mb-3 flex items-center gap-1 text-[12px] text-insu-muted">
        <span aria-hidden="true">{countryFlag(active.location?.country ?? 'MX')}</span>
        <span>{active.location?.city ?? ''}</span>
      </p>

      {/* Period toggle */}
      {hasBoth && (
        <div className="mb-3 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={(e) => handleToggle(e, 'morning')}
            className={cn(
              'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.07em] transition-colors',
              activePeriod === 'morning'
                ? 'border-category-urban/30 bg-category-urban/10 text-category-urban'
                : 'border-white/10 text-insu-muted hover:border-white/20 hover:text-insu-text'
            )}
          >
            {morningTime && <span className="font-normal normal-case tracking-normal opacity-70">{morningTime}</span>}
            <span>Morning</span>
            {recommendedPeriod === 'morning' && recommendedOnOther && (
              <span className="h-1 w-1 rounded-full bg-blue-400" />
            )}
          </button>
          <button
            onClick={(e) => handleToggle(e, 'evening')}
            className={cn(
              'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.07em] transition-colors',
              activePeriod === 'evening'
                ? 'border-category-urban/30 bg-category-urban/10 text-category-urban'
                : 'border-white/10 text-insu-muted hover:border-white/20 hover:text-insu-text'
            )}
          >
            {eveningTime && <span className="font-normal normal-case tracking-normal opacity-70">{eveningTime}</span>}
            <span>Evening</span>
            {recommendedPeriod === 'evening' && recommendedOnOther && (
              <span className="h-1 w-1 rounded-full bg-blue-400" />
            )}
          </button>
        </div>
      )}

      {/* Price rows */}
      <div className="mb-3.5 space-y-0">
        {tiers.map((tier) => (
          <div
            key={tier.id}
            className="flex flex-col gap-0.5 border-b border-white/[0.04] py-1.5 last:border-none lg:flex-row lg:items-center lg:justify-between lg:gap-0"
          >
            <span className="text-[12px] font-medium text-insu-muted">
              {TIER_LABELS[tier.name]}
            </span>
            <span className="whitespace-nowrap font-mono text-[13px] font-bold text-insu-text">
              {displayPrice(tier.premium_usd, displayMode, active.location?.country).formatted}
              <span className="mx-1 font-normal text-insu-muted">/</span>
              <span className="text-insu-green">
                {displayPrice(tier.payout_usd, displayMode, active.location?.country).formatted}
              </span>
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium text-insu-muted">
          <span aria-hidden="true" className="inline-block h-[5px] w-[5px] rounded-full bg-insu-green vol-dot-pulse" />
          {formatVolume(active.total_volume_usd)} Vol.
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            router.push(`/markets/${active.slug}`)
          }}
          className="rounded-lg bg-insu-text px-3.5 py-1.5 text-[13px] font-bold text-bg transition-all hover:scale-105 hover:bg-insu-accent"
        >
          Buy now
        </button>
      </div>
    </article>
  )
}
