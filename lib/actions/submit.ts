'use server'

import { createClient } from '@/lib/supabase/server'

export interface SubmitProgramInput {
  title: string
  description: string
  category_id: string
  trigger_type: string
  trigger_description: string
  location_city: string
  location_country: string
  event_date: string
  proposed_payout: string
}

export async function submitProgram(input: SubmitProgramInput): Promise<{ id: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('You must be signed in to submit a program')

  const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    + '-' + Date.now().toString(36)

  const { data: contract, error } = await supabase
    .from('contracts')
    .insert({
      slug,
      title: input.title,
      description: input.description,
      category_id: input.category_id,
      status: 'pending',
      trigger_type: input.trigger_type,
      trigger_condition: {
        description: input.trigger_description,
        ...(input.proposed_payout ? { proposed_payout: input.proposed_payout } : {}),
        _user_submission: true,
      },
      trigger_deadline: new Date(input.event_date + 'T12:00:00Z').toISOString(),
      location: { city: input.location_city, country: input.location_country, lat: 0, lng: 0 },
      is_featured: false,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to submit program: ${error.message}`)
  return { id: (contract as { id: string }).id }
}
