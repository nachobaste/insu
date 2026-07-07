import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import ProfileForm from '@/components/profile/ProfileForm'
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '@/lib/types'

export default async function ProfilePage() {
  const isConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  if (!isConfigured) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, preferred_currency, notification_prefs, created_at')
    .eq('id', user.id)
    .single()

  const p = (profile ?? {}) as {
    full_name: string | null
    role: string
    preferred_currency: 'USD' | 'MXN'
    notification_prefs: NotificationPrefs | null
    created_at: string
  }

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-8">
        <h1 className="mb-8 font-display text-[32px] tracking-[2px] text-insu-text">Profile</h1>
        <ProfileForm
          email={user.email ?? ''}
          role={p.role ?? 'hedger'}
          createdAt={p.created_at}
          fullName={p.full_name ?? ''}
          preferredCurrency={p.preferred_currency ?? 'USD'}
          notificationPrefs={{ ...DEFAULT_NOTIFICATION_PREFS, ...(p.notification_prefs ?? {}) }}
        />
      </main>
    </>
  )
}
