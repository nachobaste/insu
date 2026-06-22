import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { AdminMfaGateWrapper } from '@/components/admin/AdminMfaGateWrapper'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if ((profile as { role: string } | null)?.role !== 'admin') redirect('/')

  // Require AAL2 (verified TOTP MFA) before any admin page renders. This mirrors
  // the server-side assertAdmin() enforcement on every write, and keeps sensitive
  // read views (payouts, audit log) behind MFA too. The gate handles first-time
  // enrollment as well as per-session verification.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal?.currentLevel !== 'aal2') {
    return <AdminMfaGateWrapper />
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex flex-1">
        <AdminSidebar />
        <main className="flex-1 overflow-auto p-8">{children}</main>
      </div>
    </div>
  )
}
