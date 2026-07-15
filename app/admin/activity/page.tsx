import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserActivity } from '@/lib/actions/adminActivity'
import { UserActivityTable } from '@/components/admin/activity/UserActivityTable'

export default async function AdminActivityPage() {
  // The admin layout enforces admin + AAL2 MFA, but getUserActivity reads via the
  // service client (bypasses RLS), so re-verify admin here (defense in depth).
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) redirect('/auth/login')
  const { data: profile } = await userClient.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') redirect('/')

  const users = await getUserActivity()

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-insu-text">User activity</h1>
      <p className="mb-4 text-[13px] text-insu-muted">
        {users.length} user{users.length === 1 ? '' : 's'} · click a row for the full timeline
      </p>
      <UserActivityTable users={users} />
    </div>
  )
}
