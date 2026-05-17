import { createServiceClient } from '@/lib/supabase/server'
import { ContractList } from '@/components/admin/contracts/ContractList'
import type { ContractWithTiers } from '@/lib/types'

export default async function AdminContractsPage() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('contracts')
    .select('*, category:categories(*), coverage_tiers(*)')
    .order('created_at', { ascending: false })

  return <ContractList contracts={(data ?? []) as ContractWithTiers[]} />
}
