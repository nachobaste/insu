'use client'

import { cn, formatCurrency } from '@/lib/utils'
import type { CoverageTier, CoverageLevel } from '@/lib/types'

interface Props {
  tiers: CoverageTier[]
  selectedTierId: string | null
  onSelect: (tierId: string) => void
  mode?: 'buy' | 'provide'
  periodFactor?: number
}

const TIER_LABELS: Record<CoverageLevel, string> = {
  basic:   'Basic',
  premium: 'Pro',
}

export default function TierSelector({ tiers, selectedTierId, onSelect, mode = 'buy', periodFactor }: Props) {
  const sorted = [...tiers].sort((a, b) => (a.name === 'basic' ? -1 : b.name === 'basic' ? 1 : 0))
  const factor = periodFactor ?? 1.0

  return (
    <div className="space-y-2">
      {sorted.map((tier) => {
        const isSelected = tier.id === selectedTierId
        const remaining = tier.max_capacity_usd - tier.current_capacity_usd
        const isFull = mode === 'provide'
          ? remaining <= 0
          : tier.current_capacity_usd < tier.payout_usd
        const displayPremium = Math.round(tier.premium_usd * factor * 100) / 100

        return (
          <button
            key={tier.id}
            disabled={isFull}
            onClick={() => onSelect(tier.id)}
            className={cn(
              'w-full rounded-card border p-4 text-left transition-all',
              isSelected
                ? 'border-insu-accent bg-insu-accent/5'
                : 'border-white/[0.07] bg-bg-card hover:border-white/15',
              isFull && 'cursor-not-allowed opacity-40',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-insu-text">
                {TIER_LABELS[tier.name]}
              </span>
              {isSelected && (
                <span className="text-[11px] font-bold text-insu-accent">✓ Selected</span>
              )}
              {isFull && !isSelected && (
                <span className="text-[11px] text-insu-muted">
                  {mode === 'provide' ? 'Pool full' : 'No capital yet'}
                </span>
              )}
            </div>

            {mode === 'buy' ? (
              <div className="mt-1 flex items-center gap-1 font-mono text-[12px]">
                <span className="text-insu-text">{formatCurrency(displayPremium, 'USD')}</span>
                <span className="text-insu-muted">premium →</span>
                <span className="text-insu-green">{formatCurrency(tier.payout_usd, 'USD')}</span>
                <span className="text-insu-muted">payout</span>
              </div>
            ) : (
              <p className="mt-1 font-mono text-[12px] text-insu-muted">
                {formatCurrency(remaining, 'USD')} capacity remaining
              </p>
            )}
          </button>
        )
      })}
    </div>
  )
}
