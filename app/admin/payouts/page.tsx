import { createClient } from '@/lib/supabase/server'
import { PayoutQueue } from '@/components/admin/payouts/PayoutQueue'

export default async function AdminPayoutsPage() {
  const supabase = createClient()

  const { data } = await supabase
    .from('payouts')
    .select(`
      id,
      amount_usd,
      status,
      created_at,
      transfer_id,
      contract:contracts(title),
      hedger_position:hedger_positions(
        profile:profiles(full_name)
      )
    `)
    .order('created_at', { ascending: false })

  const payouts = (data ?? []).map((row) => {
    const r = row as {
      id: string; amount_usd: number; status: string; created_at: string; transfer_id: string | null
      contract: { title: string } | null
      hedger_position: { profile: { full_name: string | null } | null } | null
    }
    return {
      id: r.id,
      amount_usd: r.amount_usd,
      status: r.status,
      created_at: r.created_at,
      transfer_id: r.transfer_id,
      contractTitle: r.contract?.title ?? '—',
      userFullName: r.hedger_position?.profile?.full_name ?? null,
    }
  })

  return <PayoutQueue payouts={payouts} />
}
