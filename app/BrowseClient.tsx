'use client'

import { useState, useMemo } from 'react'
import CategoryTabs from '@/components/layout/CategoryTabs'
import StatsBar from '@/components/contracts/StatsBar'
import ContractSection from '@/components/contracts/ContractSection'
import TrendingSection from '@/components/contracts/TrendingSection'
import { useRealtimeContracts } from '@/hooks/useRealtimeContracts'
import { scoreTrending } from '@/lib/trending'
import type { Category, ContractWithTiers } from '@/lib/types'

interface Props {
  categories: Category[]
  initialContracts: ContractWithTiers[]
  stats: {
    totalVolumeUsd: number
    activeContracts: number
    protectionsSold: number
    avgPayoutMinutes: number
  }
}

export default function BrowseClient({ categories, initialContracts, stats }: Props) {
  const [activeSlug, setActiveSlug] = useState<string>('all')
  const contracts = useRealtimeContracts(initialContracts)
  const trendingContracts = useMemo(() => scoreTrending(contracts), [contracts])

  const visibleCategories =
    activeSlug === 'all'
      ? categories
      : categories.filter((c) => c.slug === activeSlug)

  return (
    <>
      <CategoryTabs
        categories={categories}
        activeSlug={activeSlug}
        onSelect={(slug) => setActiveSlug(slug === activeSlug ? 'all' : slug)}
      />

      <main className="mx-auto max-w-[1320px] px-8 py-7">
        <StatsBar stats={stats} />

        {trendingContracts.length >= 2 && (
          <TrendingSection contracts={trendingContracts} currency="USD" />
        )}

        {visibleCategories.map((cat) => {
          const catContracts = contracts.filter(
            (c) => c.category?.slug === cat.slug
          )
          if (catContracts.length === 0) return null
          return (
            <ContractSection
              key={cat.id}
              categoryName={cat.name}
              categorySlug={cat.slug}
              contracts={catContracts}
              currency="USD"
            />
          )
        })}
      </main>
    </>
  )
}
