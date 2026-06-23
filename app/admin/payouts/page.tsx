import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { PayoutQueue } from '@/components/admin/payouts/PayoutQueue'

export default async function AdminPayoutsPage() {
  // The admin layout already enforces admin + AAL2 MFA, but this page reads with
  // the service-role client (which bypasses RLS), so re-verify the caller is an
  // admin here too — defense in depth against the page rendering outside its
  // layout.
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) redirect('/auth/login')
  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if ((profile as { role: string } | null)?.role !== 'admin') redirect('/')

  // The "Own payouts" RLS policy only exposes a buyer's own payouts, so a
  // user-scoped read returns nothing for an admin viewing the queue. The joins
  // into hedger_positions/profiles are own-only too. Read via the service client
  // so admins see every payout (and the buyer's name) regardless of ownership.
  const supabase = createServiceClient()

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
