'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import LogoutButton from './LogoutButton'

interface Props {
  userId: string | null
  isAdmin: boolean
}

// Compact nav for phones, where the full header nav (How it works + auth) is
// hidden. Shown only below the `sm` breakpoint; the desktop nav handles ≥sm.
export default function MobileMenu({ userId, isAdmin }: Props) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  const itemCls =
    'block rounded-md px-3 py-2 text-[14px] font-medium text-insu-dim transition-colors hover:bg-white/[0.06] hover:text-insu-text'

  return (
    <div className="relative sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        className="relative z-50 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-white/[0.07] text-insu-dim transition-colors hover:text-insu-text"
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>

      {open && (
        <>
          {/* Tap-outside backdrop */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={close}
            className="fixed inset-0 z-40 cursor-default"
          />

          {/* Dropdown panel */}
          <nav className="absolute right-0 top-[calc(100%+10px)] z-50 w-52 rounded-xl border border-white/[0.08] bg-bg-card p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
            <Link href="/how-it-works" onClick={close} className={itemCls}>
              How it works
            </Link>

            {userId ? (
              <>
                {isAdmin && (
                  <Link href="/admin" onClick={close} className={itemCls}>
                    Admin
                  </Link>
                )}
                <Link href="/dashboard" onClick={close} className={itemCls}>
                  Portfolio
                </Link>
                <div
                  onClick={close}
                  className="mt-1 border-t border-white/[0.06] pt-1.5 [&>button]:w-full [&>button]:border-0 [&>button]:text-left"
                >
                  <LogoutButton />
                </div>
              </>
            ) : (
              <>
                <Link href="/auth/login" onClick={close} className={itemCls}>
                  Log In
                </Link>
                <Link
                  href="/auth/signup"
                  onClick={close}
                  className="mt-1 block rounded-md bg-insu-accent px-3 py-2 text-center text-[14px] font-bold text-bg transition-colors hover:bg-[#f7b84a]"
                >
                  Sign Up
                </Link>
              </>
            )}
          </nav>
        </>
      )}
    </div>
  )
}
