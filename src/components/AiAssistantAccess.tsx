import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CurrentBusiness } from '../lib/business'
import VoiceAssistant from './VoiceAssistant'

/** A paid plan preference is not an entitlement. The backend quota/entitlement
 * function is the source of truth. Hide API-backed AI when it isn't available. */
export default function AiAssistantAccess({ business, onChanged, onAvailabilityChange }: {
  business: CurrentBusiness
  onChanged: () => void
  onAvailabilityChange?: (available: boolean) => void
}) {
  const [access, setAccess] = useState<'checking' | 'paid' | 'unavailable'>('checking')
  useEffect(() => { onAvailabilityChange?.(access === 'paid') }, [access, onAvailabilityChange])
  useEffect(() => {
    let active = true
    setAccess('checking')
    if(!['owner','admin','office','technician','viewer'].includes(business.role)){setAccess('unavailable');return()=>{active=false}}
    void Promise.resolve(supabase.rpc('get_plan_usage', { target_business_id: business.id })).then(({ data, error }) => {
      if (!active) return
      if (error || data?.plan !== 'pro' || Number(data?.ai_limit || 0) <= 0 || Number(data?.voice_limit || 0) <= 0) {
        setAccess('unavailable')
      } else {
        setAccess('paid')
      }
    }).catch(() => { if (active) setAccess('unavailable') })
    return () => { active = false }
  }, [business.id,business.role])

  if (access === 'paid') return <VoiceAssistant key={`${business.id}:${business.role}:${(business.access_modules||[]).slice().sort().join(",")}`} business={business} onChanged={onChanged} />
  // Unentitled accounts never expose an apparently functional AI button.
  // The AI Office Assistant is described under My services and on the homepage.
  return null
}
