'use client'

import { AdminMfaGate } from './AdminMfaGate'

export function AdminMfaGateWrapper() {
  return <AdminMfaGate onVerified={() => window.location.reload()} />
}
