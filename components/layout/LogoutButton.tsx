'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LogoutButton() {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    if (!supabase) return
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      className="rounded-lg border border-white/[0.07] px-4 py-1.5 text-[13px] font-semibold text-insu-dim transition-colors hover:border-white/15 hover:text-insu-text"
    >
      Log Out
    </button>
  )
}
