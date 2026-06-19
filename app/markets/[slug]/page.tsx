import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import ContractDetailClient from '@/components/markets/ContractDetailClient'
import { TrafficPulseBar } from '@/components/markets/TrafficPulseBar'
import { TrafficPulseBarRefresher } from '@/components/markets/TrafficPulseBarRefresher'
import { CorridorMap } from '@/components/markets/CorridorMap'
import { CorridorPeriodSwitch, type PeriodOption } from '@/components/markets/CorridorPeriodSwitch'
import { getContractPeriod } from '@/lib/corridors'
import type { ContractDetailData, LatestOracleReading, OracleReading, Corridor } from '@/lib/types'

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
        pricing_history(id, tier_id, premium_usd_after, calculated_at),
        corridor:corridors(*)
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

  const [latestReadingResult, sparklineResult] = await Promise.all([
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
  ])

  if (latestReadingResult.error) {
    console.error('[MarketPage] oracle fetch failed:', latestReadingResult.error.message)
  }
  if (sparklineResult.error) {
    console.error('[MarketPage] sparkline fetch failed:', sparklineResult.error.message)
  }

  const latestReading = latestReadingResult.data as LatestOracleReading | null
  const sparklineReadings = (sparklineResult.data ?? []) as OracleReading[]
  const corridor = contract.corridor as Corridor | null

  // Corridor protections come in morning/evening pairs sharing a road. Fetch the
  // sibling(s) so the detail page can offer the same period toggle as the dashboard card.
  let periodOptions: PeriodOption[] = []
  if (contract.trigger_type === 'urban' && corridor) {
    const { data: roadCorridors } = await supabase
      .from('corridors')
      .select('id')
      .eq('road', corridor.road)

    const corridorIds = ((roadCorridors ?? []) as { id: string }[]).map((c) => c.id)
    if (corridorIds.length > 1) {
      const { data: roadContracts } = await supabase
        .from('contracts')
        .select('slug, corridor:corridors(window_start)')
        .in('corridor_id', corridorIds)
        .in('status', ['active', 'settled'])

      const rows = (roadContracts ?? []) as Array<{
        slug: string
        corridor: { window_start: string } | null
      }>
      periodOptions = rows.flatMap((c) => {
        const windowStart = c.corridor?.window_start
        if (!windowStart) return []
        return [{
          slug: c.slug,
          windowStart,
          period: getContractPeriod({ window_start: windowStart } as Corridor),
        }]
      })
    }
  }

  const activePeriod = corridor ? getContractPeriod(corridor) : null

  const triggerCondition = contract.trigger_condition

  return (
    <>
      <Header />
      {contract.trigger_type === 'urban' && corridor && (
        <div className="mx-auto max-w-4xl space-y-3 px-4 pb-2 pt-4">
          {activePeriod && periodOptions.length > 1 && (
            <CorridorPeriodSwitch active={activePeriod} options={periodOptions} />
          )}
          <TrafficPulseBar
            readings={sparklineReadings}
            threshold={Number(triggerCondition.threshold ?? 50)}
            windowStart={corridor.window_start}
            windowEnd={corridor.window_end}
            triggerDescription={String(triggerCondition.description ?? '')}
          />
          <CorridorMap
            originLat={corridor.origin_lat}
            originLng={corridor.origin_lng}
            destLat={corridor.dest_lat}
            destLng={corridor.dest_lng}
            corridorName={corridor.name}
          />
          <TrafficPulseBarRefresher />
        </div>
      )}
      <ContractDetailClient contract={contract} userId={userId} latestReading={latestReading} />
    </>
  )
}
