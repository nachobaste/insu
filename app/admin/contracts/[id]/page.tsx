import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { ContractForm } from '@/components/admin/contracts/ContractForm'
import type { Category, ContractWithTiers } from '@/lib/types'

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createServiceClient()

  const categoriesResult = await supabase.from('categories').select('*').order('display_order')
  const contractResult = await supabase
    .from('contracts')
    .select('*, category:categories(*), coverage_tiers(*), corridor:corridors(*)')
    .eq('id', id)
    .single()

  const contract = contractResult.data
  if (!contract) notFound()

  return (
    <ContractForm
      categories={(categoriesResult.data ?? []) as Category[]}
      contract={contract as unknown as ContractWithTiers}
    />
  )
}
