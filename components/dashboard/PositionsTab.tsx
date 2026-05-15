import Link from 'next/link'
import { PositionCard } from './PositionCard'
import type { ProviderPositionWithContract } from '@/lib/types'

export function PositionsTab({ positions }: { positions: ProviderPositionWithContract[] }) {
  if (positions.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="font-body text-sm text-insu-muted">
          No capital deployed yet —{' '}
          <Link href="/" className="text-insu-accent underline underline-offset-2">
            Browse contracts →
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {positions.map(p => <PositionCard key={p.id} position={p} />)}
    </div>
  )
}
