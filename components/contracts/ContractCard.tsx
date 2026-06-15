'use client'

import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { cn, formatCurrency, formatVolume, countryFlag } from '@/lib/utils'
import type { ContractWithTiers, Currency, CoverageLevel } from '@/lib/types'

const CARD_STYLES: Record<string, string> = {
  urban:       'before:bg-category-urban hover:shadow-[0_8px_32px_rgba(148,163,184,0.08),0_0_0_1px_rgba(148,163,184,0.15)]',
  nature:      'before:bg-category-nature hover:shadow-[0_8px_32px_rgba(52,211,153,0.08),0_0_0_1px_rgba(52,211,153,0.2)]',
  experiences: 'before:bg-category-experiences hover:shadow-[0_8px_32px_rgba(251,146,60,0.08),0_0_0_1px_rgba(251,146,60,0.2)]',
  events:      'before:bg-category-events hover:shadow-[0_8px_32px_rgba(167,139,250,0.08),0_0_0_1px_rgba(167,139,250,0.2)]',
}

const ICON_BG: Record<string, string> = {
  urban:       'bg-category-urban/10',
  nature:      'bg-category-nature/10',
  experiences: 'bg-category-experiences/10',
  events:      'bg-category-events/10',
}

const TIER_LABELS: Record<CoverageLevel, string> = {
  basic:   'Basic coverage',
  premium: 'Premium coverage',
}

interface Props {
  contract: ContractWithTiers
  currency: Currency
  badge?: 'trending' | 'new' | 'live' | 'recommended'
}

const BADGE_STYLES = {
  trending:    'bg-insu-accent/15 text-insu-accent border border-insu-accent/25',
  new:         'bg-insu-green/10 text-insu-green border border-insu-green/25',
  live:        'bg-red-500/12 text-red-400 border border-red-500/25 animate-pulse',
  recommended: 'bg-blue-400/15 text-blue-400 border border-blue-400/25',
}

export default function ContractCard({ contract, currency, badge }: Props) {
  const router = useRouter()
  const slug = contract.category.slug
  const tiers = [...contract.coverage_tiers].sort((a, b) =>
    a.name === 'basic' ? -1 : b.name === 'basic' ? 1 : 0
  )

  return (
    <article
      onClick={() => router.push(`/markets/${contract.slug}`)}
      className={cn(
        'relative cursor-pointer overflow-hidden rounded-card border border-white/[0.07] bg-bg-card p-[18px]',
        'transition-all duration-200 hover:-translate-y-0.5 hover:bg-bg-card-hover hover:border-white/15',
        'before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:rounded-t-card',
        'card-fadein',
        CARD_STYLES[slug] ?? ''
      )}
    >
      {badge && (
        <span
          className={cn(
            'absolute right-3.5 top-3.5 rounded px-[7px] py-[3px] text-[9px] font-bold uppercase tracking-[0.1em]',
            BADGE_STYLES[badge]
          )}
        >
          {badge}
        </span>
      )}

      {/* Icon */}
      <div
        className={cn(
          'mb-3 flex h-[38px] w-[38px] items-center justify-center rounded-[10px] text-lg',
          ICON_BG[slug] ?? 'bg-white/5'
        )}
      >
        {contract.icon_url ? (
          contract.icon_url.startsWith('http') || contract.icon_url.startsWith('/') ? (
            <Image src={contract.icon_url} alt="" width={20} height={20} />
          ) : (
            <span aria-hidden="true" className="text-base leading-none">{contract.icon_url}</span>
          )
        ) : (
          <span aria-hidden="true">◆</span>
        )}
      </div>

      {/* Title */}
      <p className="mb-1.5 text-[13.5px] font-semibold leading-[1.45] text-insu-text">
        {contract.title}
      </p>

      {/* Location */}
      <p className="mb-3 flex items-center gap-1 text-[11px] text-insu-muted">
        <span aria-hidden="true">{countryFlag(contract.location?.country ?? 'MX')}</span>
        <span>{contract.location?.city ?? ''}</span>
      </p>

      {/* Price rows */}
      <div className="mb-3.5 space-y-0">
        {tiers.map((tier) => (
          <div
            key={tier.id}
            className="flex items-center justify-between border-b border-white/[0.04] py-1.5 last:border-none"
          >
            <span className="text-[11px] font-medium text-insu-muted">
              {TIER_LABELS[tier.name]}
            </span>
            <span className="font-mono text-[12px] font-bold text-insu-text">
              {formatCurrency(currency === 'USD' ? tier.premium_usd : tier.premium_mxn, currency)}
              <span className="mx-1 font-normal text-insu-muted">/</span>
              <span className="text-insu-green">
                {formatCurrency(currency === 'USD' ? tier.payout_usd : tier.payout_mxn, currency)}
              </span>
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-mono text-[10px] font-medium text-insu-muted">
          <span aria-hidden="true" className="inline-block h-[5px] w-[5px] rounded-full bg-insu-green vol-dot-pulse" />
          {formatVolume(contract.total_volume_usd)} Vol.
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            router.push(`/markets/${contract.slug}`)
          }}
          className="rounded-lg bg-insu-text px-3.5 py-1.5 text-[12px] font-bold text-bg transition-all hover:scale-105 hover:bg-insu-accent"
        >
          Buy now
        </button>
      </div>
    </article>
  )
}
