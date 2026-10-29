import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CurrentBusiness } from '../lib/business'
import VoiceAssistant from './VoiceAssistant'

/** A paid plan preference is not an entitlement. The backend quota/entitlement
 * function is the source of truth. Hide API-backed AI when it isn't available. */
export default function AiAssistantAccess({ business, onChanged }: {
  business: CurrentBusiness
  onChanged: () => void
}) {
  const [access, setAccess] = useState<'checking' | 'paid' | 'unavailable'>('checking')
  useEffect(() => {
    let active = true
    setAccess('checking')
    void Promise.resolve(supabase.rpc('get_plan_usage', { target_business_id: business.id })).then(({ data, error }) => {
      if (!active) return
      if (error || data?.plan !== 'pro' || Number(data?.ai_limit || 0) <= 0 || Number(data?.voice_limit || 0) <= 0) {
        setAccess('unavailable')
      } else {
        setAccess('paid')
      }
    }).catch(() => { if (active) setAccess('unavailable') })
    return () => { active = false }
  }, [business.id])

  if (access === 'paid') return <VoiceAssistant business={business} onChanged={onChanged} />
  // Unentitled accounts never expose an apparently functional AI button.
  // The AI Office Assistant is described under My services and on the homepage.
  return null
}
