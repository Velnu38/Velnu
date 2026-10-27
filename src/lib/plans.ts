import { supabase } from './supabase'

export type PlanTier = 'free' | 'basic' | 'pro'

export const planOptions: Array<{
  tier: PlanTier; name: string; subtitle: string; price: string; status: string; features: string[]
}> = [
  {
    tier: 'free', name: 'Free', subtitle: 'A professional starting point',
    price: '$0', status: 'Available for private beta',
    features: ['Create manual estimates and invoices', 'Customer and job records', 'Company branding and printable documents', 'Basic workspace and payment records'],
  },
  {
    tier: 'basic', name: 'Basic', subtitle: 'AI-assisted everyday operations',
    price: 'Pricing coming soon', status: 'Join the Basic interest list',
    features: ['Proposed Free plan features', 'Voice-assisted invoice and estimate drafts', 'AI command interpretation and business context', 'Future AI allowances to be announced'],
  },
  {
    tier: 'pro', name: 'Pro', subtitle: 'Tools for growing teams',
    price: 'Pricing coming soon', status: 'Join the Pro interest list',
    features: ['Proposed Basic plan features', 'Future customer approvals and delivery tools', 'Expanded workflow automation and reminders', 'More team and messaging options planned'],
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
