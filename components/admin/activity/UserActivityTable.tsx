'use client'

import { Fragment, useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import type { UserActivity, TesterStatus, TimelineItem } from '@/lib/admin/activity'

const STATUS_LABEL: Record<TesterStatus, string> = {
  completed_loop: '✅ Completed loop',
  holding: '⏳ Holding',
  abandoned_checkout: '⚠️ Abandoned checkout',
  signed_up_idle: '💤 Idle',
  active_other: '· Active',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function TimelineRow({ item }: { item: TimelineItem }) {
  return (
    <div className="flex items-baseline gap-3 py-1 text-[13px]">
      <span className="w-28 flex-shrink-0 text-insu-dim">{fmtDate(item.at)}</span>
      <span className="text-insu-text">{item.primary}</span>
      {item.amountUsd != null && <span className="font-mono text-insu-green">{formatCurrency(item.amountUsd, 'USD')}</span>}
      {item.meta && <span className="text-insu-muted">{item.meta}</span>}
    </div>
  )
}

export function UserActivityTable({ users }: { users: UserActivity[] }) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (users.length === 0) {
    return <p className="text-[13px] text-insu-muted">No users yet.</p>
  }

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.07]">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wider text-insu-muted">
          <tr>
            <th className="px-3 py-2">Tester</th>
            <th className="px-3 py-2">Logins</th>
            <th className="px-3 py-2">Last login</th>
            <th className="px-3 py-2">Buys</th>
            <th className="px-3 py-2">Deposits</th>
            <th className="px-3 py-2">Premium</th>
            <th className="px-3 py-2">Payouts</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <Fragment key={u.userId}>
              <tr
                onClick={() => setOpenId((prev) => (prev === u.userId ? null : u.userId))}
                className="cursor-pointer border-t border-white/[0.05] hover:bg-white/[0.03]"
              >
                <td className="px-3 py-2">
                  <div className="font-medium text-insu-text">{u.name || '(no name)'}</div>
                  <div className="text-[11px] text-insu-dim">{u.email ?? '—'}</div>
                </td>
                <td className="px-3 py-2 font-mono">{u.loginCount}</td>
                <td className="px-3 py-2 text-insu-muted">{fmtDate(u.lastLoginAt)}</td>
                <td className="px-3 py-2 font-mono">{u.buys.length}</td>
                <td className="px-3 py-2 font-mono">{u.deposits.length}</td>
                <td className="px-3 py-2 font-mono">{formatCurrency(u.totalPremiumUsd, 'USD')}</td>
                <td className="px-3 py-2 font-mono text-insu-green">{formatCurrency(u.totalPayoutUsd, 'USD')}</td>
                <td className="px-3 py-2 whitespace-nowrap">{STATUS_LABEL[u.status]}</td>
              </tr>
              {openId === u.userId && (
                <tr className="border-t border-white/[0.05] bg-white/[0.02]">
                  <td colSpan={8} className="px-4 py-3">
                    {u.timeline.map((item, i) => (
                      <TimelineRow key={i} item={item} />
                    ))}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
