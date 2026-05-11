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

export default async function BrowsePage() {
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
