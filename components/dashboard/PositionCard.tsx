import Link from 'next/link'
import { cn, formatCurrency } from '@/lib/utils'
import type { ProviderPositionWithContract } from '@/lib/types'

export function PositionCard({ position }: { position: ProviderPositionWithContract }) {
  const {
    contract, tier, status,
    capital_deposited_usd, expected_return_usd, actual_return_usd,
    settled_at,
  } = position

  const isSettled = status === 'settled'
  const isLossShare =
    actual_return_usd !== null &&
    actual_return_usd < capital_deposited_usd

  // Determine badge
  const badge = isLossShare
    ? { label: 'LOSS SHARE', bg: 'bg-[#2d0a0a]', text: 'text-red-400', ring: 'ring-red-400/20' }
    : isSettled
    ? { label: 'SETTLED ✓', bg: 'bg-[#14532d]', text: 'text-insu-green', ring: 'ring-insu-green' }
    : { label: 'ACTIVE', bg: 'bg-[#14532d]', text: 'text-insu-green', ring: 'ring-insu-green/20' }

  // Yield column. Active positions show the estimated premium yield
  // (expected_return_usd is the expected profit). Settled positions show the
  // realized capital delta — actual_return_usd is the capital returned
  // (deposit minus loss share), so the delta is 0% on a clean settle and
  // negative when a trigger fired and ate into principal.
  const yieldPct = capital_deposited_usd > 0
    ? ((expected_return_usd / capital_deposited_usd) * 100).toFixed(1)
    : '0.0'

  const realizedPct =
    isSettled && actual_return_usd !== null && capital_deposited_usd > 0
      ? ((actual_return_usd - capital_deposited_usd) / capital_deposited_usd) * 100
      : null
  const realizedLabel =
    realizedPct !== null
      ? `Fees ${realizedPct >= 0 ? '+' : ''}${realizedPct.toFixed(1)}%`
      : 'Fees'

  // Settles date
  let settlesStr = '-'
  const dateSource = settled_at ?? contract.trigger_deadline ?? null
  if (dateSource) {
    settlesStr = new Date(dateSource).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  // Return column value and color
  let returnValue: string
  let returnColor: string
  if (isSettled && actual_return_usd !== null) {
    returnValue = formatCurrency(actual_return_usd)
    returnColor = isLossShare ? 'text-red-400' : 'text-insu-green'
  } else {
    returnValue = formatCurrency(expected_return_usd)
    returnColor = 'text-insu-text'
  }

  return (
    <Link href={`/markets/${contract.slug}`} className="block">
      <div className={cn(
        'rounded-card border bg-bg-card p-4 transition-colors hover:bg-bg-card-hover',
        isLossShare ? 'border-red-400/20' : isSettled ? 'border-insu-green/20' : 'border-white/[0.07]',
      )}>
        {/* header */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-body text-sm font-bold text-insu-text">{contract.title}</p>
            <p className="mt-0.5 font-body text-[12px] capitalize text-insu-muted">
              {tier.name} tier · {contract.trigger_type}
            </p>
          </div>
          <span className={cn(
            'shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] ring-1',
            badge.bg, badge.text, badge.ring,
          )}>
            {badge.label}
          </span>
        </div>

        {/* numbers */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className="font-body text-[11px] uppercase tracking-wide text-insu-muted">Capital</p>
            <p className="mt-0.5 font-mono text-sm text-insu-text">{formatCurrency(capital_deposited_usd)}</p>
          </div>
          <div className="text-center">
            <p className="font-body text-[11px] uppercase tracking-wide text-insu-muted">
              {isSettled ? realizedLabel : `Fees +${yieldPct}%`}
            </p>
            <p className={cn('mt-0.5 font-mono text-sm', returnColor)}>{returnValue}</p>
          </div>
          <div className="text-center">
            <p className="font-body text-[11px] uppercase tracking-wide text-insu-muted">Settles</p>
            <p className="mt-0.5 font-body text-sm text-insu-text">{settlesStr}</p>
          </div>
        </div>
      </div>
    </Link>
  )
}
