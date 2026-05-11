import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import BrowseClient from './BrowseClient'
import type { ContractWithTiers, Category } from '@/lib/types'

async function getCategories(): Promise<Category[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('display_order')

  if (error) throw new Error(`Failed to load categories: ${error.message}`)
  return data ?? []
}

async function getContracts(): Promise<ContractWithTiers[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('contracts')
    .select(`
      *,
      category:categories(*),
      coverage_tiers(*)
    `)
    .eq('status', 'active')
    .order('is_featured', { ascending: false })
    .order('total_volume_usd', { ascending: false })

  if (error) throw new Error(`Failed to load contracts: ${error.message}`)
  return (data ?? []) as ContractWithTiers[]
}

async function getPlatformStats() {
  const supabase = createClient()
  const { data } = await supabase
    .from('contracts')
    .select('total_volume_usd')
    .eq('status', 'active')

  const totalVolumeUsd = (data as Array<{ total_volume_usd: number | null }> ?? []).reduce(
    (sum, c) => sum + (c.total_volume_usd ?? 0),
    0
  )

  const { count: activeContracts } = await supabase
    .from('contracts')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')

  const { count: protectionsSold } = await supabase
    .from('hedger_positions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')

  return {
    totalVolumeUsd,
    activeContracts: activeContracts ?? 0,
    protectionsSold: protectionsSold ?? 0,
    avgPayoutMinutes: 4.2,
  }
}

// Fallback categories used when Supabase env vars are not configured (e.g. e2e smoke tests).
const FALLBACK_CATEGORIES: Category[] = [
  { id: '1', slug: 'urban',       name: 'Urban',       color: '#00C2FF', display_order: 1, icon_url: null },
  { id: '2', slug: 'nature',      name: 'Nature',      color: '#00D084', display_order: 2, icon_url: null },
  { id: '3', slug: 'experiences', name: 'Experiences', color: '#FF9F43', display_order: 3, icon_url: null },
  { id: '4', slug: 'events',      name: 'Events',      color: '#FF6B81', display_order: 4, icon_url: null },
]

export default async function BrowsePage() {
  const isConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )

  if (!isConfigured) {
    // Dev/test mode without Supabase credentials — render empty shell
    return (
      <>
        <Header />
        <BrowseClient
          categories={FALLBACK_CATEGORIES}
          initialContracts={[]}
          stats={{ totalVolumeUsd: 0, activeContracts: 0, protectionsSold: 0, avgPayoutMinutes: 4.2 }}
        />
      </>
    )
  }

  const [categories, contracts, stats] = await Promise.all([
    getCategories(),
    getContracts(),
    getPlatformStats(),
  ])

  return (
    <>
      <Header />
      <BrowseClient
        categories={categories}
        initialContracts={contracts}
        stats={stats}
      />
    </>
  )
}
