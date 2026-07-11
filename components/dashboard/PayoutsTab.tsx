import { PayoutRow } from './PayoutRow'
import { cn, formatCurrency } from '@/lib/utils'
import type { PayoutWithContract, HedgerPositionWithContract } from '@/lib/types'

interface PayoutsTabProps {
  payouts: PayoutWithContract[]
  hedgerPositions: HedgerPositionWithContract[]
}

export function PayoutsTab({ payouts, hedgerPositions }: PayoutsTabProps) {
  const received = payouts.reduce((sum, p) => sum + p.amount_usd, 0)
  const spent = hedgerPositions.reduce((sum, p) => sum + p.premium_paid_usd, 0)
  const net = received - spent
  const showSummary = payouts.length > 0 || hedgerPositions.length > 0

  return (
    <div>
      {showSummary && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/[0.07] bg-bg-card p-4 text-center">
            <p className="font-mono text-2xl font-bold text-insu-green">{formatCurrency(received)}</p>
            <p className="mt-1 font-body text-[11px] uppercase tracking-wide text-insu-muted">Received</p>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-bg-card p-4 text-center">
            <p className="font-mono text-2xl font-bold text-insu-text">{formatCurrency(spent)}</p>
            <p className="mt-1 font-body text-[11px] uppercase tracking-wide text-insu-muted">Spent</p>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-bg-card p-4 text-center">
            <p className={cn(
              'font-mono text-2xl font-bold',
              net >= 0 ? 'text-insu-green' : 'text-red-400',
            )}>
              {net >= 0 ? `+${formatCurrency(net)}` : formatCurrency(net)}
            </p>
            <p className="mt-1 font-body text-[11px] uppercase tracking-wide text-insu-muted">Net</p>
          </div>
        </div>
      )}

      {payouts.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-body text-sm text-insu-muted">
            No payouts yet. Payouts appear here when a trigger fires.
          </p>
        </div>
      ) : (
        <div>
          {payouts.map(p => <PayoutRow key={p.id} payout={p} />)}
        </div>
      )}
    </div>
  )
}
