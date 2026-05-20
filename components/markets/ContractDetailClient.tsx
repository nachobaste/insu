'use client'

import { useState } from 'react'
import { cn, formatCurrency, categoryTextClass, countryFlag } from '@/lib/utils'
import type { ContractDetailData } from '@/lib/types'
import ContractMeta from './ContractMeta'
import PriceChart from './PriceChart'
import PurchasePanel from './PurchasePanel'

type PanelMode = 'buy' | 'provide'

interface Props {
  contract: ContractDetailData
  userId: string | null
}

export default function ContractDetailClient({ contract, userId }: Props) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelMode, setPanelMode] = useState<PanelMode>('buy')

  const slug = contract.category.slug
  const sortedTiers = [...contract.coverage_tiers].sort((a, b) =>
    a.name === 'basic' ? -1 : b.name === 'basic' ? 1 : 0,
  )

  function openPanel(mode: PanelMode) {
    setPanelMode(mode)
    setPanelOpen(true)
  }

  return (
    <main className="mx-auto max-w-[1320px] px-8 py-10">
      <div className="grid grid-cols-[1fr_360px] items-start gap-8">
        {/* Left column */}
        <div className="space-y-5">
          <div>
            <span className={cn('text-[11px] font-bold uppercase tracking-[0.12em]', categoryTextClass(slug))}>
              {contract.category.name}
            </span>
            <h1 className="mt-1 text-[24px] font-semibold leading-snug text-insu-text">
              {contract.title}
            </h1>
            {contract.location?.city && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-insu-muted">
                <span aria-hidden="true">{countryFlag(contract.location?.country ?? 'MX')}</span>
                <span>{contract.location.city}</span>
              </p>
            )}
            {contract.description && (
              <p className="mt-2 text-[14px] text-insu-muted">{contract.description}</p>
            )}
          </div>

          <PriceChart history={contract.pricing_history} tiers={contract.coverage_tiers} />

          <ContractMeta contract={contract} />
        </div>

        {/* Right column — sticky */}
        <div className="sticky top-[80px] space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-insu-muted">
            Select tier
          </p>

          <div className="space-y-2">
            {sortedTiers.map((tier) => (
              <div
                key={tier.id}
                className="rounded-card border border-white/[0.07] bg-bg-card p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold capitalize text-insu-text">
                    {tier.name}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1 font-mono text-[12px]">
                  <span className="text-insu-text">{formatCurrency(tier.premium_usd, 'USD')}</span>
                  <span className="text-insu-muted">→</span>
                  <span className="text-insu-green">{formatCurrency(tier.payout_usd, 'USD')}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2 pt-1">
            <button
              onClick={() => openPanel('buy')}
              className="w-full rounded-lg bg-insu-accent py-3 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a]"
            >
              Buy Protection
            </button>
            <button
              onClick={() => openPanel('provide')}
              className="w-full rounded-lg border border-white/[0.07] bg-bg-card py-3 text-[14px] font-semibold text-insu-text transition-all hover:border-white/15"
            >
              Provide Capital
            </button>
          </div>
        </div>
      </div>

      <PurchasePanel
        contract={contract}
        userId={userId}
        open={panelOpen}
        initialMode={panelMode}
        onClose={() => setPanelOpen(false)}
      />
    </main>
  )
}
