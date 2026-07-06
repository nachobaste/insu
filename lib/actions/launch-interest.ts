'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Toggle the signed-in user's notify-me interest for a coming-soon contract.
 * Returns the new state. Uses the user-scoped client so RLS owns the rows.
 */
export async function toggleLaunchInterest(contractId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: existing } = await supabase
    .from('launch_interest')
    .select('contract_id')
    .eq('contract_id', contractId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('launch_interest')
      .delete()
      .eq('contract_id', contractId)
      .eq('user_id', user.id)
    return false
  }

  const { error } = await supabase
    .from('launch_interest')
    .insert({ contract_id: contractId, user_id: user.id })
  if (error) throw new Error(`Could not save interest: ${error.message}`)
  return true
}
