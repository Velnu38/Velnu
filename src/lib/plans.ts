import { supabase } from './supabase'

export type PlanTier = 'free' | 'basic' | 'pro'

export const planOptions: Array<{
  tier: PlanTier; name: string; subtitle: string; price: string; status: string; features: string[]
}> = [
  {
    tier: 'free', name: 'Free', subtitle: 'A professional starting point',
    price: '$0', status: 'Manual tools · No metered services',
    features: ['Manual estimates and invoices; printable PDF', 'Customer and job records within storage limits', 'Company name, address, phone and text branding', '0 online customer acceptances', '0 AI calls, cloud voice, automated email, SMS and third-party paid services'],
  },
  {
    tier: 'basic', name: 'Basic', subtitle: 'AI-assisted everyday operations',
    price: 'Pricing coming soon', status: 'Join the Basic interest list',
    features: ['Proposed Free plan features', 'AI ASSISTANT · voice-to-invoice and estimate drafts', 'AI ASSISTANT · customer/job lookup and unpaid invoice summaries', 'AI ASSISTANT · business context and clarification questions', 'Planned hosted company logos and limited AI allowance', '0 online customer acceptances'],
  },
  {
    tier: 'pro', name: 'Pro', subtitle: 'Tools for growing teams',
    price: 'Pricing coming soon', status: 'Join the Pro interest list',
    features: ['Proposed Basic plan features', 'AI ASSISTANT · expanded office workflows', 'Online estimate acceptance with recorded agreement to terms', 'Customer email, reminders, messaging with usage limits', 'Team and automation options (planned)'],
  },
]

export async function getPlanPreference(userId: string): Promise<PlanTier | null> {
  const { data, error } = await supabase.from('user_plan_preferences')
    .select('selected_tier')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  const tier = data?.selected_tier
  return tier === 'free' || tier === 'basic' || tier === 'pro' ? tier : null
}

export async function savePlanPreference(userId: string, tier: PlanTier): Promise<void> {
  const { data, error } = await supabase.from('user_plan_preferences')
    .upsert({ user_id: userId, selected_tier: tier, selected_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('selected_tier')
    .single()
  if (error) throw error
  if (data?.selected_tier !== tier) throw new Error('Your plan selection could not be verified. Please try again.')
}
