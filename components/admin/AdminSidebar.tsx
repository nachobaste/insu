'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/admin/contracts', label: 'Contracts', icon: '📋' },
  { href: '/admin/trigger',   label: 'Trigger',   icon: '⚡' },
  { href: '/admin/oracle',    label: 'Oracle',    icon: '🌐' },
  { href: '/admin/scenario',  label: 'Scenario',  icon: '🧪' },
  { href: '/admin/payouts',   label: 'Payouts',   icon: '💸' },
  { href: '/admin/activity',  label: 'Activity',  icon: '👥' },
] as const

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex w-44 flex-shrink-0 flex-col border-r border-white/[0.07] bg-bg px-3 py-5">
      <p className="mb-5 px-2 font-display text-sm tracking-[3px] text-insu-accent">
        ADMIN
      </p>
      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
              pathname.startsWith(href)
                ? 'bg-white/[0.07] text-insu-text'
                : 'text-insu-dim hover:bg-white/[0.04] hover:text-insu-text',
            )}
          >
            <span>{icon}</span>
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
