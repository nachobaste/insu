import { createClient } from '@supabase/supabase-js'
import type { Contract, HedgerPosition, ProviderPosition } from '@/lib/types'

interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

interface StripeClient {
  customers: {
    create: (params: { metadata: Record<string, string> }) => Promise<{ id: string }>
    createBalanceTransaction: (
      customerId: string,
      params: { amount: number; currency: string },
    ) => Promise<{ id: string }>
  }
}

function getClient(): DbClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  )
}

export async function processPayouts(
  db: DbClient = getClient(),
  stripe: StripeClient,
): Promise<number> {
  const { data: triggeredReadings } = await db
    .from('oracle_readings')
    .select('contract_id, read_at')
    .eq('trigger_met', true)

  if (!triggeredReadings || triggeredReadings.length === 0) return 0

  // Build map of contractId → earliest trigger timestamp
  const triggerMap = new Map<string, string>()
  for (const r of triggeredReadings as Array<{ contract_id: string; read_at: string }>) {
    const existing = triggerMap.get(r.contract_id)
    if (!existing || r.read_at < existing) {
      triggerMap.set(r.contract_id, r.read_at)
    }
  }

  const contractIds = Array.from(triggerMap.keys())

  const { data: contracts } = await db
    .from('contracts')
    .select('*')
    .in('id', contractIds)
    .eq('status', 'active')
    .is('settled_outcome', null)

  if (!contracts || contracts.length === 0) return 0

  let total = 0
  for (const contract of contracts as Contract[]) {
    const triggerReadAt = triggerMap.get(contract.id) ?? new Date().toISOString()
    total += await settleContract(db, stripe, contract, triggerReadAt)
  }
  return total
}

async function settleContract(
  db: DbClient,
  stripe: StripeClient,
  contract: Contract,
  triggerReadAt: string,
): Promise<number> {
  await db.from('contracts')
    .update({ settled_outcome: true, status: 'settled', settled_at: new Date().toISOString() })
    .eq('id', contract.id)

  const { data: positions } = await db
    .from('hedger_positions')
    .select('*')
    .eq('contract_id', contract.id)
    .eq('status', 'active')

  if (!positions) return 0

  // Skip positions whose coverage window closed before the trigger fired
  const eligiblePositions = (positions as HedgerPosition[]).filter((pos) =>
    !pos.coverage_period_days ||
    new Date(pos.expires_at) >= new Date(triggerReadAt),
  )

  let paid = 0
  let totalHedgerPayout = 0
  for (const position of eligiblePositions) {
    const amountPaid = await payoutPosition(db, stripe, contract.id, position)
    if (amountPaid > 0) {
      paid++
      totalHedgerPayout += amountPaid
    }
  }

  await settleProviderPositions(db, contract.id, totalHedgerPayout)

  return paid
}

async function payoutPosition(
  db: DbClient,
  stripe: StripeClient,
  contractId: string,
  position: HedgerPosition,
): Promise<number> {
  // Fetch authoritative payout amount from the tier, not the stored position value
  const { data: tier } = await db
    .from('coverage_tiers')
    .select('payout_usd, payout_mxn')
    .eq('id', position.tier_id)
    .single()
  const payoutAmountUsd = tier ? Number((tier as { payout_usd: number }).payout_usd) : position.payout_amount_usd
  const payoutAmountMxn = tier ? Number((tier as { payout_mxn: number }).payout_mxn) : position.payout_amount_mxn

  const { data: profile } = await db
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', position.user_id)
    .single()

  let customerId = (profile as { stripe_customer_id: string | null } | null)?.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({ metadata: { user_id: position.user_id } })
    customerId = customer.id
    await db.from('profiles').update({ stripe_customer_id: customerId }).eq('id', position.user_id)
  }

  const { data: payout } = await db.from('payouts')
    .insert({
      contract_id: contractId,
      hedger_position_id: position.id,
      amount_usd: payoutAmountUsd,
      amount_mxn: payoutAmountMxn,
      currency: position.currency,
      payment_provider: 'stripe',
      status: 'processing',
    })
    .select('id')
    .single()

  if (!payout) {
    console.error(`Failed to create payout record for position ${position.id}`)
    return 0
  }

  let txnId: string
  try {
    const txn = await stripe.customers.createBalanceTransaction(customerId, {
      amount: -Math.round(payoutAmountUsd * 100),
      currency: 'usd',
    })
    txnId = txn.id
  } catch (err) {
    console.error(`Stripe balance transaction failed for position ${position.id}:`, err)
    await db.from('payouts')
      .update({ status: 'failed' })
      .eq('id', (payout as { id: string }).id)
    return 0
  }

  await db.from('payouts')
    .update({ status: 'completed', transfer_id: txnId, completed_at: new Date().toISOString() })
    .eq('id', (payout as { id: string }).id)

  await db.from('hedger_positions').update({ status: 'paid_out' }).eq('id', position.id)
  return payoutAmountUsd
}

async function settleProviderPositions(
  db: DbClient,
  contractId: string,
  totalHedgerPayout: number,
): Promise<void> {
  const { data: positions } = await db
    .from('provider_positions')
    .select('*')
    .eq('contract_id', contractId)
    .eq('status', 'active')

  if (!positions || positions.length === 0) return

  const totalProviderCapital = (positions as ProviderPosition[])
    .reduce((sum, p) => sum + p.capital_deposited_usd, 0)

  for (const position of positions as ProviderPosition[]) {
    const lossShare = totalProviderCapital > 0
      ? (position.capital_deposited_usd / totalProviderCapital) * totalHedgerPayout
      : 0
    const actualReturn = Math.round(Math.max(0, position.capital_deposited_usd - lossShare) * 100) / 100

    await db.from('provider_positions')
      .update({ status: 'settled', actual_return_usd: actualReturn, settled_at: new Date().toISOString() })
      .eq('id', position.id)
  }
}

export async function expireContracts(db: DbClient = getClient()): Promise<number> {
  const now = new Date().toISOString()

  const { data: pastDeadline } = await db
    .from('contracts')
    .select('id')
    .eq('status', 'active')
    .eq('is_recurring', false)
    .is('settled_outcome', null)
    .lt('trigger_deadline', now)

  let expiredCount = 0

  for (const contract of (pastDeadline ?? []) as Array<{ id: string }>) {
    await db.from('contracts')
      .update({ status: 'settled', settled_outcome: false, settled_at: now })
      .eq('id', contract.id)

    await db.from('hedger_positions')
      .update({ status: 'expired' })
      .eq('contract_id', contract.id)
      .eq('status', 'active')

    const { data: providerPositions } = await db
      .from('provider_positions')
      .select('id, capital_deposited_usd')
      .eq('contract_id', contract.id)
      .eq('status', 'active')

    for (const pos of (providerPositions ?? []) as Array<{ id: string; capital_deposited_usd: number }>) {
      await db.from('provider_positions')
        .update({ status: 'settled', actual_return_usd: pos.capital_deposited_usd, settled_at: now })
        .eq('id', pos.id)
    }

    expiredCount++
  }

  // Expire stale hedger positions on any active contract (covers recurring contracts)
  await db.from('hedger_positions')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('expires_at', now)

  return expiredCount
}
