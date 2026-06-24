'use client'

import { cn, formatCurrency } from '@/lib/utils'
import type { CoverageTier, CoverageLevel } from '@/lib/types'

interface Props {
  tiers: CoverageTier[]
  selectedTierId: string | null
  onSelect: (tierId: string) => void
  mode?: 'buy' | 'provide'
  priceByTier?: Record<string, number>
  /** Tier ids that can't be chosen for the current selection, mapped to a short reason (e.g. Pro on a 1-day window). */
  lockedReasonByTier?: Record<string, string>
}

const TIER_LABELS: Record<CoverageLevel, string> = {
  basic:   'Basic',
  premium: 'Pro',
}

/** Human description of how many times a tier can pay out before it knocks out. */
function payoutDescription(maxPayouts: number): string {
  return maxPayouts > 1 ? `Pays out up to ${maxPayouts} times` : 'Pays out once'
}

export default function TierSelector({ tiers, selectedTierId, onSelect, mode = 'buy', priceByTier, lockedReasonByTier }: Props) {
  const sorted = [...tiers].sort((a, b) => (a.name === 'basic' ? -1 : b.name === 'basic' ? 1 : 0))

  return (
    <div className="space-y-2">
      {sorted.map((tier) => {
        const isSelected = tier.id === selectedTierId
        const remaining = tier.max_capacity_usd - tier.current_capacity_usd
        const isFull = mode === 'provide'
          ? remaining <= 0
          : tier.current_capacity_usd < tier.payout_usd
        const lockedReason = lockedReasonByTier?.[tier.id]
        const isDisabled = isFull || Boolean(lockedReason)
        const displayPremium = priceByTier?.[tier.id] ?? tier.premium_usd
        // Right-aligned status note: a lock reason takes precedence over the capacity note.
        const statusNote = lockedReason ?? (isFull ? (mode === 'provide' ? 'Pool full' : 'No capital yet') : null)

        return (
          <button
            key={tier.id}
            disabled={isDisabled}
            onClick={() => onSelect(tier.id)}
            className={cn(
              'w-full rounded-card border p-4 text-left transition-all',
              isSelected
                ? 'border-insu-accent bg-insu-accent/5'
                : 'border-white/[0.07] bg-bg-card hover:border-white/15',
              isDisabled && 'cursor-not-allowed opacity-40',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-insu-text">
                {TIER_LABELS[tier.name]}
              </span>
              {isSelected ? (
                <span className="text-[12px] font-bold text-insu-accent">✓ Selected</span>
              ) : statusNote ? (
                <span className="text-[12px] text-insu-muted">{statusNote}</span>
              ) : null}
            </div>

            <p className="mt-0.5 text-[12px] text-insu-muted">
              {payoutDescription(tier.max_payouts)}
            </p>

            {mode === 'buy' ? (
              <div className="mt-1 flex items-center gap-1 font-mono text-[13px]">
                <span className="text-insu-text">{formatCurrency(displayPremium, 'USD')}</span>
                <span className="text-insu-muted">premium →</span>
                <span className="text-insu-green">{formatCurrency(tier.payout_usd, 'USD')}</span>
                <span className="text-insu-muted">payout</span>
              </div>
            ) : (
              <p className="mt-1 font-mono text-[13px] text-insu-muted">
                {formatCurrency(remaining, 'USD')} capacity remaining
              </p>
            )}
          </button>
        )
      })}
    </div>
  )
}
