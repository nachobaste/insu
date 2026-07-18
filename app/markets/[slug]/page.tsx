import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import ContractDetailClient from '@/components/markets/ContractDetailClient'
import { CorridorEvidence } from '@/components/markets/CorridorEvidence'
import { CorridorMarketView } from '@/components/markets/CorridorMarketView'
import { getContractPeriod, type PeriodBundle } from '@/lib/corridors'
import type { ContractDetailData, LatestOracleReading, OracleReading, Corridor } from '@/lib/types'
import type { DisplayMode } from '@/lib/currency/config'
import { aggregateDailyOracleSeries, type DailyMetricPoint } from '@/lib/oracle/dailySeries'

const CONTRACT_SELECT = `
  *,
  category:categories(*),
  coverage_tiers(*),
  pricing_history(id, tier_id, premium_usd_after, calculated_at),
  corridor:corridors(*)
`

/** Fetch ~30 days of readings and reduce to a daily in-window-max metric series. */
async function loadOracleSeries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  contract: ContractDetailData,
): Promise<DailyMetricPoint[]> {
  const tc = contract.trigger_condition as Record<string, unknown>
  const metric = typeof tc.metric === 'string' ? tc.metric : null
  if (!metric) return []

  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('oracle_readings')
    .select('read_at, value')
    .eq('contract_id', contract.id)
    .gte('read_at', cutoff)
    .order('read_at', { ascending: false })
    .limit(5000)

  if (error) {
    console.error('[MarketPage] series fetch failed:', error.message)
    return []
  }

  const corridor = contract.corridor as Corridor | null
  const timeWindow = corridor ? { start: corridor.window_start, end: corridor.window_end } : null
  return aggregateDailyOracleSeries(
    (data ?? []) as { read_at: string; value: Record<string, unknown> }[],
    metric,
    timeWindow,
  )
}

/** Load the oracle readings for one corridor contract into a renderable bundle. */
async function loadBundle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  contract: ContractDetailData,
): Promise<PeriodBundle> {
  const corridor = contract.corridor as Corridor

  const [latestReadingResult, sparklineResult, metricSeries] = await Promise.all([
    supabase
      .from('oracle_readings')
      .select('value, read_at, source, trigger_met')
      .eq('contract_id', contract.id)
      .order('read_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('oracle_readings')
      .select('*')
      .eq('contract_id', contract.id)
      .order('read_at', { ascending: false })
      .limit(6),
    loadOracleSeries(supabase, contract),
  ])

  if (latestReadingResult.error) {
    console.error('[MarketPage] oracle fetch failed:', latestReadingResult.error.message)
  }
  if (sparklineResult.error) {
    console.error('[MarketPage] sparkline fetch failed:', sparklineResult.error.message)
  }

  return {
    period: getContractPeriod(corridor),
    slug: contract.slug,
    contract,
    corridor,
    latestReading: latestReadingResult.data as LatestOracleReading | null,
    sparklineReadings: (sparklineResult.data ?? []) as OracleReading[],
    metricSeries,
  }
}

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
    supabase.from('contracts').select(CONTRACT_SELECT).eq('slug', slug).in('status', ['active', 'settled']).single(),
    supabase.auth.getUser(),
  ])

  const contractData = contractResult.data
  if (contractResult.error || !contractData) notFound()

  const contract = contractData as unknown as ContractDetailData
  const userId = userResult.data.user?.id ?? null

  let displayMode: DisplayMode = 'USD'
  if (userId) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('preferred_currency')
      .eq('id', userId)
      .single()
    displayMode = prof?.preferred_currency === 'LOCAL' ? 'LOCAL' : 'USD'
  }
  const corridor = contract.corridor as Corridor | null
  const comingSoon = contract.launch_stage === 'coming_soon'

  // For a corridor contract, find its sibling (same road, opposite period).
  let sibling: ContractDetailData | null = null
  if (contract.trigger_type === 'urban' && corridor) {
    const { data: roadCorridors } = await supabase
      .from('corridors')
      .select('id')
      .eq('road', corridor.road)

    const siblingCorridorId = ((roadCorridors ?? []) as { id: string }[])
      .map((c) => c.id)
      .find((id) => id !== corridor.id)

    if (siblingCorridorId) {
      const { data: siblingData } = await supabase
        .from('contracts')
        .select(CONTRACT_SELECT)
        .eq('corridor_id', siblingCorridorId)
        .in('status', ['active', 'settled'])
        .maybeSingle()
      if (siblingData) sibling = siblingData as unknown as ContractDetailData
    }
  }

  // Paired corridor: preload both periods, toggle instantly client-side.
  // coming-soon corridors (none today) must fall through to the notify-me view
  if (contract.trigger_type === 'urban' && corridor && sibling && !comingSoon) {
    const [openedBundle, siblingBundle] = await Promise.all([
      loadBundle(supabase, contract),
      loadBundle(supabase, sibling),
    ])
    return (
      <>
        <Header />
        <CorridorMarketView
          bundles={[openedBundle, siblingBundle]}
          initialPeriod={getContractPeriod(corridor)}
          userId={userId}
        />
      </>
    )
  }

  // Single contract: non-corridor, or a road with only one active period.
  const [latestReadingResult, sparklineResult, interestResult, metricSeries] = await Promise.all([
    supabase
      .from('oracle_readings')
      .select('value, read_at, source, trigger_met')
      .eq('contract_id', contract.id)
      .order('read_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    contract.trigger_type === 'urban'
      ? supabase
          .from('oracle_readings')
          .select('*')
          .eq('contract_id', contract.id)
          .order('read_at', { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null, error: null }),
    comingSoon && userId
      ? supabase
          .from('launch_interest')
          .select('contract_id')
          .eq('contract_id', contract.id)
          .eq('user_id', userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    loadOracleSeries(supabase, contract),
  ])

  if (latestReadingResult.error) {
    console.error('[MarketPage] oracle fetch failed:', latestReadingResult.error.message)
  }
  if (sparklineResult.error) {
    console.error('[MarketPage] sparkline fetch failed:', sparklineResult.error.message)
  }

  const latestReading = latestReadingResult.data as LatestOracleReading | null
  const sparklineReadings = (sparklineResult.data ?? []) as OracleReading[]
  const triggerCondition = contract.trigger_condition
  const initiallyInterested = !!interestResult.data

  return (
    <>
      <Header />
      <ContractDetailClient
        contract={contract}
        userId={userId}
        latestReading={latestReading}
        comingSoon={comingSoon}
        initiallyInterested={initiallyInterested}
        displayMode={displayMode}
        metricSeries={metricSeries}
        evidence={
          contract.trigger_type === 'urban' && corridor ? (
            <CorridorEvidence
              corridor={corridor}
              readings={sparklineReadings}
              triggerCondition={triggerCondition}
            />
          ) : undefined
        }
      />
    </>
  )
}
