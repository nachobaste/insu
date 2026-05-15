import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { HedgerPositionWithContract } from '@/lib/types'

export function ProtectionCard({ position }: { position: HedgerPositionWithContract }) {
  const {
    contract, tier, status,
    premium_paid_usd, payout_amount_usd,
    purchased_at, expires_at,
  } = position

  const now = Date.now()
  const expiresMs = new Date(expires_at).getTime()
  const purchasedMs = new Date(purchased_at).getTime()
  const totalDays = Math.max(1, Math.round((expiresMs - purchasedMs) / 86_400_000))
  const daysLeft = Math.max(0, Math.round((expiresMs - now) / 86_400_000))
  const progressPct = Math.min(100, (daysLeft / totalDays) * 100)

  const isPaidOut = status === 'paid_out'
  const isExpired = status === 'expired'

  const badge = isPaidOut
    ? { label: 'PAID OUT ✓', bg: 'bg-[#14532d]', text: 'text-insu-green', ring: 'ring-insu-green' }
    : isExpired
    ? { label: 'EXPIRED', bg: 'bg-[#1c2333]', text: 'text-insu-muted', ring: 'ring-white/10' }
    : { label: 'ACTIVE', bg: 'bg-[#14532d]', text: 'text-insu-green', ring: 'ring-insu-green/20' }

  const dateStr = new Date(expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <Link href={`/markets/${contract.slug}`} className="block">
      <div className={cn(
        'rounded-xl border bg-bg-card p-4 transition-colors hover:bg-bg-card-hover',
        isPaidOut ? 'border-insu-green/20' : 'border-white/[0.07]',
        isExpired && 'opacity-50',
      )}>
        {/* header */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-body text-sm font-bold text-insu-text">{contract.title}</p>
            <p className="mt-0.5 font-body text-[11px] capitalize text-insu-muted">
              {tier.name} tier · {contract.trigger_type}
            </p>
          </div>
          <span className={cn(
            'shrink-0 rounded-full px-2 py-0.5 font-mono text-[8px] ring-1',
            badge.bg, badge.text, badge.ring,
          )}>
            {badge.label}
          </span>
        </div>

        {/* numbers */}
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className="font-body text-[8px] uppercase tracking-wide text-insu-muted">Paid</p>
            <p className="mt-0.5 font-mono text-sm text-insu-text">${premium_paid_usd}</p>
          </div>
          <div className="text-center">
            <p className="font-body text-[8px] uppercase tracking-wide text-insu-muted">
              {isPaidOut ? 'Received' : 'Payout'}
            </p>
            <p className="mt-0.5 font-mono text-sm text-insu-green">${payout_amount_usd}</p>
          </div>
          <div className="text-center">
            <p className="font-body text-[8px] uppercase tracking-wide text-insu-muted">
              {isPaidOut ? 'Settled' : 'Expires'}
            </p>
            <p className="mt-0.5 font-body text-sm text-insu-text">{dateStr}</p>
          </div>
        </div>

        {/* progress bar — active only */}
        {status === 'active' && (
          <div>
            <div className="h-[3px] overflow-hidden rounded-full bg-[#0d1117]">
              <div
                className="h-full rounded-full bg-insu-accent transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mt-1 font-body text-[8px] text-insu-muted">
              {daysLeft} days left of {totalDays}
            </p>
          </div>
        )}
      </div>
    </Link>
  )
}
