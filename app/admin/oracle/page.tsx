import { createClient } from '@/lib/supabase/server'
import { OracleMonitor } from '@/components/admin/oracle/OracleMonitor'
import type { Contract, OracleReading } from '@/lib/types'

export default async function AdminOraclePage() {
  const supabase = await createClient()

  const { data: contracts } = await supabase
    .from('contracts')
    .select('*')
    .eq('status', 'active')
    .order('created_at')

  const activeContracts = (contracts ?? []) as unknown as Contract[]

  const items = await Promise.all(
    activeContracts.map(async (contract) => {
      const { data: readings } = await supabase
        .from('oracle_readings')
        .select('*')
        .eq('contract_id', contract.id)
        .order('read_at', { ascending: false })
        .limit(20)

      const rows = (readings ?? []) as OracleReading[]

      return {
        contract,
        latest: rows[0] ?? null,
        readings: rows,
      }
    }),
  )

  return <OracleMonitor items={items} />
}
