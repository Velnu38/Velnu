import type {FinDestination} from '../lib/finNavigation'
import {setAssistantAvailable} from '../lib/assistantEntry'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CurrentBusiness } from '../lib/business'
import type { FinInvoiceDraft } from '../lib/voiceDocument'
import type { InvoiceSourceTarget } from '../services/finInvoiceSources'
import VoiceAssistant from './VoiceAssistant'

/** A paid plan preference is not an entitlement. The backend quota/entitlement
 * function is the source of truth. Hide API-backed AI when it isn't available. */
export default function AiAssistantAccess({ business, onChanged, onOpenInvoice, onNavigate, onAvailabilityChange }: {
  business: CurrentBusiness
  onNavigate?: (destination: FinDestination) => Promise<boolean>
  onChanged: () => void
  onOpenInvoice: (draft: FinInvoiceDraft | InvoiceSourceTarget) => boolean
  onAvailabilityChange?: (available: boolean) => void
}) {
  const [revision,setRevision]=useState(0)
  useEffect(()=>{const changed=()=>setRevision(v=>v+1);window.addEventListener('finviant-tier-changed',changed);return()=>window.removeEventListener('finviant-tier-changed',changed)},[])
  const [access, setAccess] = useState<'checking' | 'paid' | 'unavailable'>('checking')
  useEffect(() => { setAssistantAvailable(access === 'paid');onAvailabilityChange?.(access === 'paid');return()=>setAssistantAvailable(false) }, [access, onAvailabilityChange])
  useEffect(() => {
    let active = true
    setAccess('checking')
    if(!['owner','admin','office','technician','viewer'].includes(business.role)){setAccess('unavailable');return()=>{active=false}}
    void Promise.resolve(supabase.rpc('get_plan_usage', { target_business_id: business.id })).then(({ data, error }) => {
      if (!active) return
      if (error || Number(data?.ai_limit || 0) <= 0 || Number(data?.voice_limit || 0) <= 0) {
        setAccess('unavailable')
      } else {
        setAccess('paid')
      }
    }).catch(() => { if (active) setAccess('unavailable') })
    return () => { active = false }
  }, [business.id,business.role,revision])

  if (access === 'paid') return <VoiceAssistant key={`${business.id}:${business.role}:${(business.access_modules||[]).slice().sort().join(",")}`} business={business} onNavigate={onNavigate} onChanged={onChanged} onOpenInvoice={onOpenInvoice} />
  // Unentitled accounts never expose an apparently functional AI button.
  // The AI Office Assistant is described under My services and on the homepage.
  return null
}
