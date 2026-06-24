'use server'

import { createClient } from '@/lib/supabase/server'
import type { Notification } from '@/lib/types'

export async function getUnreadCount(): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0
  // notifications table added after types were generated; cast to bypass type check
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { count } = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null)
  return count ?? 0
}

export async function getNotifications(): Promise<Notification[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  // notifications table added after types were generated; cast to bypass type check
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data } = await db
    .from('notifications')
    .select('*, contract:contracts(slug)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)
  return (data ?? []) as Notification[]
}

export async function markAllRead(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  // notifications table added after types were generated; cast to bypass type check
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null)
}

export async function markRead(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  // notifications table added after types were generated; cast to bypass type check
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
}
