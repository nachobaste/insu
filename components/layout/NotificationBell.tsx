'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { getNotifications, markAllRead } from '@/lib/actions/notifications'
import type { Notification } from '@/lib/types'

interface Props {
  initialUnread: number
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotificationBell({ initialUnread }: Props) {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(initialUnread)
  const [items, setItems] = useState<Notification[] | null>(null)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next) {
      const list = await getNotifications()
      setItems(list)
      if (unread > 0) {
        setUnread(0)
        await markAllRead()
      }
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.07] text-insu-dim transition-colors hover:text-insu-text"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-insu-accent px-1 text-[11px] font-bold text-bg">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 top-[calc(100%+10px)] z-50 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-white/[0.08] bg-bg-card p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
            {items === null ? (
              <p className="px-3 py-6 text-center text-[13px] text-insu-muted">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-insu-muted">No notifications yet.</p>
            ) : (
              items.map((n) => {
                const inner = (
                  <div className="flex flex-col gap-0.5 rounded-md px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-insu-text">{n.title}</span>
                      <span className="flex-shrink-0 text-[12px] text-insu-muted">{timeAgo(n.created_at)}</span>
                    </div>
                    <span className="text-[13px] text-insu-dim">{n.body}</span>
                  </div>
                )
                return n.contract?.slug ? (
                  <Link key={n.id} href={`/markets/${n.contract.slug}`} onClick={() => setOpen(false)}>
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id}>{inner}</div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}
