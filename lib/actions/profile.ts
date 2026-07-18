'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '@/lib/types'

interface UpdateProfileInput {
  full_name?: string
  preferred_currency?: 'USD' | 'LOCAL'
  notification_prefs?: NotificationPrefs
}

function validPrefs(p: unknown): p is NotificationPrefs {
  if (typeof p !== 'object' || p === null) return false
  return Object.keys(DEFAULT_NOTIFICATION_PREFS).every(
    (k) => typeof (p as Record<string, unknown>)[k] === 'boolean',
  )
}

export async function updateProfile(
  input: UpdateProfileInput,
): Promise<{ ok: true } | { error: string }> {
  if (input.preferred_currency && !['USD', 'LOCAL'].includes(input.preferred_currency)) {
    return { error: 'Invalid currency' }
  }
  if (input.notification_prefs !== undefined && !validPrefs(input.notification_prefs)) {
    return { error: 'Invalid notification preferences' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const patch: Record<string, unknown> = {}
  if (input.full_name !== undefined) patch.full_name = input.full_name.trim()
  if (input.preferred_currency !== undefined) patch.preferred_currency = input.preferred_currency
  if (input.notification_prefs !== undefined) patch.notification_prefs = input.notification_prefs

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('profiles') as any).update(patch).eq('id', user.id)
  if (error) return { error: error.message }

  revalidatePath('/profile')
  return { ok: true }
}
