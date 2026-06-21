'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelContract } from '@/lib/actions/admin'

export function CancelMarketButton({ contractId, title }: { contractId: string; title: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    if (!window.confirm(
      `Cancel “${title}”? It will be removed from Browse and hidden from everyone’s dashboard. `
      + 'Existing positions are NOT refunded. This cannot be undone from here.',
    )) return

    startTransition(async () => {
      try {
        await cancelContract(contractId)
        router.refresh()
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Cancel failed')
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="text-[13px] text-red-400 hover:text-red-300 disabled:opacity-60"
    >
      {isPending ? 'Cancelling…' : 'Cancel'}
    </button>
  )
}
