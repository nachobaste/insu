import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs, type NotificationType } from '@/lib/types'

interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

interface CreateNotificationParams {
  userId: string
  type: NotificationType
  title: string
  body: string
  contractId?: string | null
}

/**
 * Best-effort: looks up the user's notification_prefs, no-ops if the relevant
 * flag is off, and never throws — a notification failure must not break the
 * payout/purchase flow that called it.
 */
export async function createNotification(db: DbClient, params: CreateNotificationParams): Promise<void> {
  try {
    const { data } = await db
      .from('profiles')
      .select('notification_prefs')
      .eq('id', params.userId)
      .single()

    const prefs: NotificationPrefs =
      (data as { notification_prefs?: NotificationPrefs } | null)?.notification_prefs
      ?? DEFAULT_NOTIFICATION_PREFS

    if (prefs[params.type] === false) return

    await db.from('notifications').insert({
      user_id: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      contract_id: params.contractId ?? null,
    })
  } catch (err) {
    console.error('createNotification failed:', err)
  }
}
