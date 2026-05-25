import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import ContractDetailClient from '@/components/markets/ContractDetailClient'
import type { ContractDetailData, LatestOracleReading } from '@/lib/types'

export default async function MarketPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const isConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  if (!isConfigured) notFound()

  const supabase = await createClient()

  const [contractResult, userResult] = await Promise.all([
    supabase
      .from('contracts')
      .select(`
        *,
        category:categories(*),
        coverage_tiers(*),
        pricing_history(id, tier_id, premium_usd_after, calculated_at)
      `)
      .eq('slug', slug)
      .in('status', ['active', 'settled'])
      .single(),
    supabase.auth.getUser(),
  ])

  // Destructure before the guard so contractData is not narrowed to never.
  const contractData = contractResult.data
  if (contractResult.error || !contractData) notFound()

  const contract = contractData as unknown as ContractDetailData
  const userId = userResult.data.user?.id ?? null

  const { data: latestReadingRaw, error: oracleError } = await supabase
    .from('oracle_readings')
    .select('value, read_at, source, trigger_met')
    .eq('contract_id', contract.id)
    .order('read_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (oracleError) console.error('[MarketPage] oracle fetch failed:', oracleError.message)

  const latestReading = latestReadingRaw as LatestOracleReading | null

  return (
    <>
      <Header />
      <ContractDetailClient contract={contract} userId={userId} latestReading={latestReading} />
    </>
  )
}
