'use client'

import { useRouter } from 'next/navigation'
import { cn, formatCurrency } from '@/lib/utils'
import type { ContractWithTiers, Currency } from '@/lib/types'

const CATEGORY_STYLES: Record<string, { border: string; icon: string; text: string; pill: string }> = {
  urban:       { border: 'border-category-urban',       icon: 'bg-category-urban/10',       text: 'text-category-urban',       pill: 'bg-category-urban/10 text-category-urban' },
  nature:      { border: 'border-category-nature',      icon: 'bg-category-nature/10',      text: 'text-category-nature',      pill: 'bg-category-nature/10 text-category-nature' },
  experiences: { border: 'border-category-experiences', icon: 'bg-category-experiences/10', text: 'text-category-experiences', pill: 'bg-category-experiences/10 text-category-experiences' },
  events:      { border: 'border-category-events',      icon: 'bg-category-events/10',      text: 'text-category-events',      pill: 'bg-category-events/10 text-category-events' },
}

const CATEGORY_ICONS: Record<string, string> = {
  urban: '🏙️', nature: '🌿', experiences: '🎿', events: '🎤',
}

interface Props {
  contracts: ContractWithTiers[]
  currency: Currency
}

export default function TrendingSection({ contracts, currency }: Props) {
  const router = useRouter()

  if (contracts.length === 0) return null

  return (
    <section className="mb-8">
      <div className="mb-4 flex items-center gap-2.5">
        <span aria-hidden="true">🔥</span>
        <h2 className="text-[13px] font-bold tracking-[0.01em] text-insu-text">Trending Now</h2>
        <span className="animate-pulse rounded px-[7px] py-[3px] text-[9px] font-bold uppercase tracking-[0.08em] bg-insu-accent/15 text-insu-accent border border-insu-accent/25">
          Live
        </span>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {contracts.map((contract) => {
          const slug = contract.category?.slug ?? 'urban'
          const styles = CATEGORY_STYLES[slug] ?? CATEGORY_STYLES.urban
          const cheapestTier = [...contract.coverage_tiers].sort((a, b) =>
            (currency === 'USD' ? a.premium_usd - b.premium_usd : a.premium_mxn - b.premium_mxn)
          )[0]
          const fromPrice = cheapestTier
            ? formatCurrency(currency === 'USD' ? cheapestTier.premium_usd : cheapestTier.premium_mxn, currency)
            : '—'

          return (
            <article
              key={contract.id}
              onClick={() => router.push(`/markets/${contract.slug}`)}
              className={cn(
                'relative cursor-pointer overflow-hidden rounded-card border bg-bg-card p-[14px]',
                'transition-all duration-200 hover:-translate-y-0.5 hover:bg-bg-card-hover',
                'before:absolute before:inset-x-0 before:top-0 before:h-[2px]',
                styles.border,
              )}
            >
              <div
                className={cn(
                  'mb-3 flex h-[32px] w-[32px] items-center justify-center rounded-[8px] text-base',
                  styles.icon,
                )}
              >
                <span aria-hidden="true">{CATEGORY_ICONS[slug] ?? '◆'}</span>
              </div>

              <p className="mb-2.5 text-[11px] font-semibold leading-[1.4] text-insu-text">
                {contract.title}
              </p>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[8px] font-semibold uppercase tracking-[0.06em] text-insu-muted">from</p>
                  <p className={cn('text-[12px] font-bold', styles.text)}>{fromPrice}</p>
                </div>
                <span className={cn('rounded px-[6px] py-[2px] text-[8px] font-bold uppercase tracking-[0.06em]', styles.pill)}>
                  {contract.category?.name ?? slug}
                </span>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
