import { supabase } from './supabase'
import { AGREEMENT_VERSION } from '../legal/agreement'

export async function hasAcceptedAgreement(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('user_agreement_acceptances')
    .select('id').eq('user_id', userId).eq('agreement_version', AGREEMENT_VERSION)
    .maybeSingle()
  if (error) throw error
  return Boolean(data?.id)
}

export async function acceptAgreement(userId: string): Promise<void> {
  const { error } = await supabase.from('user_agreement_acceptances').insert({
    user_id: userId,
    agreement_version: AGREEMENT_VERSION,
    terms_accepted: true,
    ai_disclosure_acknowledged: true,
    electronic_records_consent: true,
    acceptance_method: 'checkbox_and_button',
  })
  if (error && error.code !== '23505') throw error
  if (!(await hasAcceptedAgreement(userId))) throw new Error('Unable to verify your agreement. Please try again.')
}
