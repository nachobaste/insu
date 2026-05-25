'use client'

import { useRouter } from 'next/navigation'
import { AdminMfaGate } from './AdminMfaGate'

export function AdminMfaGateWrapper() {
  const router = useRouter()
  return <AdminMfaGate onVerified={() => router.refresh()} />
}
