import { PayoutRow } from './PayoutRow'
import type { PayoutWithContract } from '@/lib/types'

export function PayoutsTab({ payouts }: { payouts: PayoutWithContract[] }) {
  if (payouts.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="font-body text-sm text-insu-muted">
          No payouts yet. Payouts appear here when a trigger fires.
        </p>
      </div>
    )
  }

  return (
    <div>
      {payouts.map(p => <PayoutRow key={p.id} payout={p} />)}
    </div>
  )
}
