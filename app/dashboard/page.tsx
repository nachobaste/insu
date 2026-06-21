import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import { DashboardClient } from '@/components/dashboard/DashboardClient'
import { getDashboardData } from '@/lib/actions/dashboard'

type Tab = 'protections' | 'positions' | 'payouts'
const VALID_TABS: Tab[] = ['protections', 'positions', 'payouts']

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const isConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  if (!isConfigured) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const data = await getDashboardData(user.id)
  const initialTab: Tab = VALID_TABS.includes(tab as Tab)
    ? (tab as Tab)
    : 'protections'

  return (
    <>
      <Header />
      <DashboardClient
        userId={user.id}
        hedgerPositions={data.hedgerPositions}
        providerPositions={data.providerPositions}
        payouts={data.payouts}
        initialTab={initialTab}
      />
    </>
  )
}
