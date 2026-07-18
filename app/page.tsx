import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import BrowseClient from './BrowseClient'
import type { ContractWithTiers } from '@/lib/types'
import type { DisplayMode } from '@/lib/currency/config'

async function getContracts(): Promise<ContractWithTiers[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contracts')
    .select(`
      *,
      category:categories(*),
      coverage_tiers(*),
      corridor:corridors(*)
    `)
    .eq('status', 'active')
    .order('is_featured', { ascending: false })
    .order('total_volume_usd', { ascending: false })

  if (error) throw new Error(`Failed to load contracts: ${error.message}`)
  return (data ?? []) as unknown as ContractWithTiers[]
}

async function getPlatformStats() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('contracts')
    .select('total_volume_usd')
    .eq('status', 'active')
    .eq('launch_stage', 'live')

  const totalVolumeUsd = (data as Array<{ total_volume_usd: number | null }> ?? []).reduce(
    (sum, c) => sum + (c.total_volume_usd ?? 0),
    0
  )

  const { count: activeContracts } = await supabase
    .from('contracts')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
    .eq('launch_stage', 'live')

  const { count: protectionsSold } = await supabase
    .from('hedger_positions')
    .select('*', { count: 'exact', head: true })
    .in('status', ['active', 'paid_out', 'expired'])

  return {
    totalVolumeUsd,
    activeContracts: activeContracts ?? 0,
    protectionsSold: protectionsSold ?? 0,
    avgPayoutMinutes: 4.2,
  }
}

async function getDisplayMode(): Promise<DisplayMode> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'USD'
  const { data } = await supabase
    .from('profiles')
    .select('preferred_currency')
    .eq('id', user.id)
    .single()
  return data?.preferred_currency === 'LOCAL' ? 'LOCAL' : 'USD'
}

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
          initialContracts={[]}
          stats={{ totalVolumeUsd: 0, activeContracts: 0, protectionsSold: 0, avgPayoutMinutes: 4.2 }}
          displayMode="USD"
        />
      </>
    )
  }

  const [contracts, stats, displayMode] = await Promise.all([
    getContracts(),
    getPlatformStats(),
    getDisplayMode(),
  ])

  return (
    <>
      <Header />
      <BrowseClient
        initialContracts={contracts}
        stats={stats}
        displayMode={displayMode}
      />
    </>
  )
}
