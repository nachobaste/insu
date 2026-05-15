import Link from 'next/link'
import { ProtectionCard } from './ProtectionCard'
import type { HedgerPositionWithContract } from '@/lib/types'

export function ProtectionsTab({ positions }: { positions: HedgerPositionWithContract[] }) {
  const active = positions.filter(p => p.status === 'active')
  const history = positions.filter(p => p.status !== 'active')

  if (positions.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="font-body text-sm text-insu-muted">
          No active protections yet —{' '}
          <Link href="/" className="text-insu-accent underline underline-offset-2">
            Browse contracts →
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {active.length > 0 && (
        <div>
          <p className="mb-3 font-body text-[9px] uppercase tracking-wide text-insu-muted">
            Active ({active.length})
          </p>
          <div className="space-y-3">
            {active.map(p => <ProtectionCard key={p.id} position={p} />)}
          </div>
        </div>
      )}
      {history.length > 0 && (
        <div>
          <p className="mb-3 font-body text-[9px] uppercase tracking-wide text-insu-muted">
            Expired / Paid out ({history.length})
          </p>
          <div className="space-y-3">
            {history.map(p => <ProtectionCard key={p.id} position={p} />)}
          </div>
        </div>
      )}
    </div>
  )
}
