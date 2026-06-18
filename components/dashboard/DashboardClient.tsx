'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { StatsStrip } from './StatsStrip'
import { ProtectionsTab } from './ProtectionsTab'
import { PositionsTab } from './PositionsTab'
import { PayoutsTab } from './PayoutsTab'
import type {
  HedgerPositionWithContract,
  ProviderPositionWithContract,
  PayoutWithContract,
} from '@/lib/types'

type Tab = 'protections' | 'positions' | 'payouts'

interface DashboardClientProps {
  userId: string
  hedgerPositions: HedgerPositionWithContract[]
  providerPositions: ProviderPositionWithContract[]
  payouts: PayoutWithContract[]
  initialTab: Tab
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'protections', label: 'Protections' },
  { id: 'positions', label: 'Positions' },
  { id: 'payouts', label: 'Payouts' },
]

export function DashboardClient({
  userId,
  hedgerPositions: initialHedger,
  providerPositions: initialProvider,
  payouts,
  initialTab,
}: DashboardClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = (searchParams.get('tab') as Tab | null) ?? initialTab

  const [hedgerPositions, setHedgerPositions] = useState(initialHedger)
  const [providerPositions, setProviderPositions] = useState(initialProvider)

  // Re-sync local state whenever the server component re-fetches (e.g. after a
  // router.refresh() triggered by an INSERT/DELETE realtime event). This uses
  // React's render-phase "adjust state when a prop changes" pattern rather than
  // an effect, so the resync happens before paint without cascading renders.
  const [syncedProps, setSyncedProps] = useState({ h: initialHedger, p: initialProvider })
  if (syncedProps.h !== initialHedger || syncedProps.p !== initialProvider) {
    setSyncedProps({ h: initialHedger, p: initialProvider })
    setHedgerPositions(initialHedger)
    setProviderPositions(initialProvider)
  }

  const setTab = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.push(`/dashboard?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const supabase = createClient()
    if (!supabase) return

    const hedgerChannel = supabase
      .channel('dashboard:hedger')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'hedger_positions',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setHedgerPositions(prev =>
            prev.map(p => p.id === payload.new.id ? { ...p, ...payload.new } : p)
          )
        }
      )
      // New positions / deletions need the contract+tier joins, so re-fetch
      // server-side rather than patching the raw row into local state.
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'hedger_positions',
          filter: `user_id=eq.${userId}`,
        },
        () => router.refresh()
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'hedger_positions' },
        () => router.refresh()
      )
      .subscribe()

    const providerChannel = supabase
      .channel('dashboard:provider')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'provider_positions',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setProviderPositions(prev =>
            prev.map(p => p.id === payload.new.id ? { ...p, ...payload.new } : p)
          )
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'provider_positions',
          filter: `user_id=eq.${userId}`,
        },
        () => router.refresh()
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'provider_positions' },
        () => router.refresh()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(hedgerChannel)
      supabase.removeChannel(providerChannel)
    }
  }, [userId, router])

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6">
        <p className="font-display text-[11px] uppercase tracking-[2px] text-insu-accent">My Portfolio</p>
        <p className="font-body text-[11px] text-insu-muted">Live updates · positions as of right now</p>
      </div>

      <StatsStrip hedgerPositions={hedgerPositions} providerPositions={providerPositions} />

      <div className="mb-6 flex gap-2 border-b border-white/[0.07] pb-3">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className={cn(
              'rounded-full px-4 py-1 font-body text-[11px] transition-colors',
              activeTab === tab.id
                ? 'bg-insu-accent font-bold text-bg'
                : 'border border-white/[0.07] text-insu-muted hover:text-insu-dim',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'protections' && <ProtectionsTab positions={hedgerPositions} />}
      {activeTab === 'positions' && <PositionsTab positions={providerPositions} />}
      {activeTab === 'payouts' && <PayoutsTab payouts={payouts} />}
    </div>
  )
}
