'use client'

import ContractCard from './ContractCard'
import type { ContractWithTiers } from '@/lib/types'
import type { DisplayMode } from '@/lib/currency/config'

interface Props {
  contracts: ContractWithTiers[]
  displayMode: DisplayMode
}

/** Dimmed rail of not-yet-live coverage at the bottom of the browse page. */
export default function ComingSoonSection({ contracts, displayMode }: Props) {
  if (contracts.length === 0) return null

  return (
    <section className="mt-12">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="font-display text-[22px] tracking-[2px] text-insu-muted">🔜 Coming soon</h2>
        <p className="text-[13px] font-medium tracking-[0.05em] text-insu-muted">
          Protection we&apos;re building — tap a card to get notified at launch
        </p>
        <div className="h-px flex-1 bg-white/[0.05]" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {contracts.map((contract) => (
          <ContractCard key={contract.id} contract={contract} displayMode={displayMode} comingSoon />
        ))}
      </div>
    </section>
  )
}
