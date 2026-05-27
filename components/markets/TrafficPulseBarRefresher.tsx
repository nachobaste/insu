'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function TrafficPulseBarRefresher() {
  const router = useRouter()

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 10 * 60 * 1000)
    return () => clearInterval(id)
  }, [router])

  return null
}
