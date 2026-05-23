import { createClient } from '@/lib/supabase/server'
import { ScenarioPanel } from '@/components/admin/scenario/ScenarioPanel'
import type { Contract } from '@/lib/types'

export default async function AdminScenarioPage() {
  const supabase = createClient()

  const { data: contracts } = await supabase
    .from('contracts')
    .select('id, slug, title, trigger_type, trigger_condition, trigger_deadline')
    .eq('status', 'active')
    .is('settled_outcome', null)
    .order('trigger_deadline')

  const activeContracts = (contracts ?? []) as unknown as Contract[]

  return <ScenarioPanel contracts={activeContracts} />
}
