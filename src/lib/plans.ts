import { supabase } from './supabase'
import { monthlyPlans, formatMonthlyPrice } from './pricing'

export type PlanTier = 'free' | 'basic' | 'pro'

export const planOptions: Array<{
  tier: PlanTier; name: string; subtitle: string; price: string; status: string; features: string[]
}> = (['free', 'basic', 'pro'] as const).map(tier => ({
  tier,
  name: monthlyPlans[tier].name,
  subtitle: tier === 'free' ? 'A professional starting point' :
    tier === 'basic' ? 'Affordable AI-assisted essentials' : 'Expanded tools for growing teams',
  price: tier === 'free' ? 'Free' : formatMonthlyPrice(tier) + ' / month',
  status: monthlyPlans[tier].status,
  features: monthlyPlans[tier].features,
}))

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
