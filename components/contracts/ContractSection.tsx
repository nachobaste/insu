'use client'

import { useState } from 'react'
import ContractCard from './ContractCard'
import AddContractCard from './AddContractCard'
import { cn } from '@/lib/utils'
import { getUrbanRoads } from '@/lib/corridors'
import type { ContractWithTiers, Currency, CategoryName } from '@/lib/types'

const SECTION_STYLES: Record<string, string> = {
  urban:       'text-category-urban',
  nature:      'text-category-nature',
  experiences: 'text-category-experiences',
  events:      'text-category-events',
}

const SECTION_DESCRIPTIONS: Record<string, string> = {
  urban:       'City disruptions · Infrastructure · Mobility',
  nature:      'Weather · Earthquakes · Temperature extremes',
  experiences: 'Travel · Outdoor activities · Vacations',
  events:      'Concerts · Conferences · Public gatherings',
}

const SECTION_ICONS: Record<string, string> = {
  urban:       '🏙️',
  nature:      '🌿',
  experiences: '🎿',
  events:      '🎤',
}

const CHIP_BASE = 'rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] transition-colors'
const CHIP_ACTIVE = 'border-category-urban/30 bg-category-urban/10 text-category-urban'
const CHIP_INACTIVE = 'border-white/10 text-insu-muted hover:text-insu-text hover:border-white/20'

interface Props {
  categoryName: CategoryName
  categorySlug: string
  contracts: ContractWithTiers[]
  currency: Currency
}

export default function ContractSection({
  categoryName,
  categorySlug,
  contracts,
  currency,
}: Props) {
  const [activeRoad, setActiveRoad] = useState<string | null>(null)

  const roads = categorySlug === 'urban' ? getUrbanRoads(contracts) : []
  const visibleContracts = activeRoad
    ? contracts.filter((c) => c.corridor?.road === activeRoad)
    : contracts

  return (
    <section className="mt-9 first:mt-0">
      <div className="mb-4 flex items-baseline gap-3">
        <h2
          className={cn(
            'font-display text-[28px] tracking-[2px]',
            SECTION_STYLES[categorySlug] ?? ''
          )}
        >
          {SECTION_ICONS[categorySlug]} {categoryName}
        </h2>
        <p className="text-[12px] font-medium tracking-[0.05em] text-insu-muted">
          {SECTION_DESCRIPTIONS[categorySlug]}
        </p>
        <div className="h-px flex-1 bg-white/[0.07]" />
      </div>

      {roads.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveRoad(null)}
            className={cn(CHIP_BASE, activeRoad === null ? CHIP_ACTIVE : CHIP_INACTIVE)}
          >
            All
          </button>
          {roads.map((road) => (
            <button
              key={road}
              onClick={() => setActiveRoad(activeRoad === road ? null : road)}
              className={cn(CHIP_BASE, activeRoad === road ? CHIP_ACTIVE : CHIP_INACTIVE)}
            >
              {road}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        {visibleContracts.map((contract) => (
          <ContractCard
            key={contract.id}
            contract={contract}
            currency={currency}
            badge={contract.is_featured ? 'trending' : undefined}
          />
        ))}
        <AddContractCard />
      </div>
    </section>
  )
}
