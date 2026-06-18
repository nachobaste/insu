import Link from 'next/link'
import { cn, formatCurrency } from '@/lib/utils'
import type { PayoutWithContract } from '@/lib/types'

export function PayoutRow({ payout }: { payout: PayoutWithContract }) {
  const { contract, amount_usd, status, created_at } = payout

  const isCompleted = status === 'completed'

  const badge = isCompleted
    ? { label: 'COMPLETED', bg: 'bg-[#14532d]', text: 'text-insu-green' }
    : { label: 'PROCESSING', bg: 'bg-[#2a1f0a]', text: 'text-insu-accent' }

  const dateStr = new Date(created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <Link href={`/markets/${contract.slug}`} className="block">
      <div className="flex items-center justify-between border-b border-white/[0.07] py-3 transition-colors hover:bg-bg-card-hover px-1">
        <div className="min-w-0 flex-1">
          <p className="truncate font-body text-sm text-insu-text">{contract.title}</p>
          <p className="mt-0.5 font-body text-[11px] text-insu-muted">{dateStr}</p>
        </div>
        <div className="ml-4 flex items-center gap-3">
          <p className="font-mono text-sm text-insu-green">{formatCurrency(amount_usd)}</p>
          <span className={cn(
            'shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px]',
            badge.bg, badge.text,
          )}>
            {badge.label}
          </span>
        </div>
      </div>
    </Link>
  )
}
