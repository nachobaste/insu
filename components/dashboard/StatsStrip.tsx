import { formatCurrency } from '@/lib/utils'
import type { HedgerPositionWithContract, ProviderPositionWithContract } from '@/lib/types'

interface StatsStripProps {
  hedgerPositions: HedgerPositionWithContract[]
  providerPositions: ProviderPositionWithContract[]
}

export function StatsStrip({ hedgerPositions, providerPositions }: StatsStripProps) {
  const activeCovers = hedgerPositions.filter(p => p.status === 'active').length

  const coveredUpTo = hedgerPositions
    .filter(p => p.status === 'active')
    .reduce((sum, p) => sum + p.payout_amount_usd, 0)

  const providerYield = providerPositions
    .filter(p => p.status === 'active')
    .reduce((sum, p) => sum + p.expected_return_usd, 0)

  return (
    <div className="mb-6 grid grid-cols-3 gap-3">
      <div className="rounded-xl border border-white/[0.07] bg-bg-card p-4 text-center">
        <p className="font-mono text-2xl font-bold text-insu-text">{activeCovers}</p>
        <p className="mt-1 font-body text-[11px] uppercase tracking-wide text-insu-muted">Active covers</p>
      </div>
      <div className="rounded-xl border border-white/[0.07] bg-bg-card p-4 text-center">
        <p className="font-mono text-2xl font-bold text-insu-green">{formatCurrency(coveredUpTo)}</p>
        <p className="mt-1 font-body text-[11px] uppercase tracking-wide text-insu-muted">Covered up to</p>
      </div>
      <div className="rounded-xl border border-white/[0.07] bg-bg-card p-4 text-center">
        <p className="font-mono text-2xl font-bold text-insu-accent">{formatCurrency(providerYield)}</p>
        <p className="mt-1 font-body text-[11px] uppercase tracking-wide text-insu-muted">Provider yield</p>
      </div>
    </div>
  )
}
