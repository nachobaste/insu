import { createClient } from '@/lib/supabase/server'
import { ContractForm } from '@/components/admin/contracts/ContractForm'
import type { Category } from '@/lib/types'

export default async function NewContractPage() {
  const supabase = createClient()
  const { data } = await supabase
    .from('categories')
    .select('*')
    .order('display_order')

  return <ContractForm categories={(data ?? []) as Category[]} />
}
