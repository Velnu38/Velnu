import { supabase } from '../lib/supabase'

const links=new Map<string,{approval_link_id:string;token:string;expires_at:string;relative_url:string;url:string}>()
export type ApprovalDocumentType = 'estimate' | 'change_order'

export async function createApprovalLink(businessId: string, documentType: ApprovalDocumentType, documentId: string, expiresDays = 14) {
  const key=businessId+':'+documentType+':'+documentId,cached=links.get(key)
  if(cached&&Date.parse(cached.expires_at)>Date.now()){try{const approval=await getCustomerApproval(cached.token);if(!approval?.completed)return cached;links.delete(key)}catch{links.delete(key);throw new Error('Unable to verify the existing link. Retry after reconnecting; no replacement link was created.')}}
  if(!window.confirm('Create an approval link? This replaces any earlier approval link for this document, including links sent in previous emails.'))throw new Error('No new approval link was created.')
  const { data, error } = await supabase.functions.invoke('create-approval-link', {
    body: {
      business_id: businessId,
      document_type: documentType,
      document_id: documentId,
      expires_days: expiresDays,
    },
  })
  if (error) throw error
  const relative = String(data.relative_url ?? `/?approval=${encodeURIComponent(data.token)}`)
  const link={
    ...data,
    url: new URL(relative, window.location.origin).toString(),
  } as { approval_link_id: string; token: string; expires_at: string; relative_url: string; url: string }
  links.set(key,link);return link
}

export async function getCustomerApproval(token: string) {
  const { data, error } = await supabase.functions.invoke('customer-approval', {
    body: { token, mode: 'view' },
  })
  if (error) throw error
  return data
}

export async function submitCustomerApproval(token: string, action: 'approved' | 'declined', typedName: string, agreedToTerms = false) {
  const { data, error } = await supabase.functions.invoke('customer-approval', {
    body: { token, mode: action, typed_name: typedName.trim(), terms_agreed: agreedToTerms },
  })
  if (error) throw error
  return data
}
