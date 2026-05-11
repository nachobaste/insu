import ContractCard from './ContractCard'
import AddContractCard from './AddContractCard'
import { cn } from '@/lib/utils'
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

      <div className="grid grid-cols-4 gap-3">
        {contracts.map((contract) => (
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
