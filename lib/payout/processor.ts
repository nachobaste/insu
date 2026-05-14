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
    .select('contract_id')
    .eq('trigger_met', true)

  if (!triggeredReadings || triggeredReadings.length === 0) return 0

  const contractIds = [...new Set((triggeredReadings as Array<{ contract_id: string }>)
    .map(r => r.contract_id))]

  const { data: contracts } = await db
    .from('contracts')
    .select('*')
    .in('id', contractIds)
    .eq('status', 'active')
    .is('settled_outcome', null)

  if (!contracts || contracts.length === 0) return 0

  let total = 0
  for (const contract of contracts as Contract[]) {
    total += await settleContract(db, stripe, contract)
  }
  return total
}

async function settleContract(
  db: DbClient,
  stripe: StripeClient,
  contract: Contract,
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

  let paid = 0
  for (const position of positions as HedgerPosition[]) {
    await payoutPosition(db, stripe, contract.id, position)
    paid++
  }

  const totalHedgerPayout = (positions as HedgerPosition[])
    .reduce((sum, p) => sum + p.payout_amount_usd, 0)
  await settleProviderPositions(db, contract.id, totalHedgerPayout)

  return paid
}

async function payoutPosition(
  db: DbClient,
  stripe: StripeClient,
  contractId: string,
  position: HedgerPosition,
): Promise<void> {
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
      amount_usd: position.payout_amount_usd,
      amount_mxn: position.payout_amount_mxn,
      currency: position.currency,
      payment_provider: 'stripe',
      status: 'processing',
    })
    .select('id')
    .single()

  if (!payout) {
    console.error(`Failed to create payout record for position ${position.id}`)
    return
  }

  let txnId: string
  try {
    const txn = await stripe.customers.createBalanceTransaction(customerId, {
      amount: -Math.round(position.payout_amount_usd * 100),
      currency: 'usd',
    })
    txnId = txn.id
  } catch (err) {
    console.error(`Stripe balance transaction failed for position ${position.id}:`, err)
    return
  }

  await db.from('payouts')
    .update({ status: 'completed', transfer_id: txnId, completed_at: new Date().toISOString() })
    .eq('id', (payout as { id: string }).id)

  await db.from('hedger_positions').update({ status: 'paid_out' }).eq('id', position.id)
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
