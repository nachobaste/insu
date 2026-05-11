'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ContractWithTiers } from '@/lib/types'

export function useRealtimeContracts(initial: ContractWithTiers[]) {
  const [contracts, setContracts] = useState<ContractWithTiers[]>(initial)

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('contracts-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'contracts',
        },
        (payload) => {
          const { category, coverage_tiers, ...flatFields } = payload.new as Partial<ContractWithTiers> & { id: string }
          setContracts((prev) =>
            prev.map((c) =>
              c.id === flatFields.id ? { ...c, ...flatFields } : c
            )
          )
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'coverage_tiers',
        },
        (payload) => {
          const updatedTier = payload.new as { id: string; contract_id: string }
          setContracts((prev) =>
            prev.map((c) =>
              c.id === updatedTier.contract_id
                ? {
                    ...c,
                    coverage_tiers: c.coverage_tiers.map((t) =>
                      t.id === updatedTier.id ? { ...t, ...(payload.new as Partial<typeof t>) } : t
                    ),
                  }
                : c
            )
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return contracts
}
