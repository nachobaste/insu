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

  if (!input.title || input.title.length > 200) throw new Error('Title must be 1-200 characters')
  if (!input.description || input.description.length > 2000) throw new Error('Description must be 1-2000 characters')
  if (!input.trigger_description || input.trigger_description.length > 1000) throw new Error('Trigger description must be 1-1000 characters')
  if (!input.location_city || input.location_city.length > 100) throw new Error('City must be 1-100 characters')
  if (!input.location_country || input.location_country.length > 100) throw new Error('Country must be 1-100 characters')
  if (input.proposed_payout && input.proposed_payout.length > 500) throw new Error('Proposed payout must be under 500 characters')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.event_date)) throw new Error('Invalid event date format')

  const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    + '-' + Date.now().toString(36)

  // Generate the id ourselves: we can't .select() the inserted row back, because
  // the public RLS read policy only exposes active/settled contracts, so reading
  // a freshly-inserted `pending` row returns zero rows and rolls the insert back.
  const id = crypto.randomUUID()

  const { error } = await supabase
    .from('contracts')
    .insert({
      id,
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

  if (error) throw new Error(`Failed to submit program: ${error.message}`)
  return { id }
}
