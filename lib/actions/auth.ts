'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Increments the current user's login counter (profiles.login_count) and stamps
 * last_login_at. Called at each successful-auth entry point so the count reflects
 * real logins, not page loads. Silent no-op if unauthenticated or on RPC error —
 * login tracking must never block a sign-in.
 */
export async function recordLogin(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.rpc as any)('increment_login_count', { p_user_id: user.id })
}
