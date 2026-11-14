import { supabase } from '../lib/supabase'

export type ApprovalDocumentType = 'estimate' | 'change_order'
export type ApprovalLink = { approval_link_id: string; token: string; expires_at: string | null; revision_id: string; relative_url: string; url: string }

/** The server reuses the current link; replacement is an explicit, atomic operation. */
export async function createApprovalLink(businessId: string, documentType: ApprovalDocumentType, documentId: string, options: { rotate?: boolean } = {}): Promise<ApprovalLink> {
  const { data, error } = await supabase.functions.invoke('create-approval-link', {
    body: { business_id: businessId, document_type: documentType, document_id: documentId, rotate: options.rotate === true },
  })
  if (error) {
    const detail = await error.context?.clone().json().catch(() => null)
    throw new Error(detail?.error || error.message || 'The customer link could not be prepared.')
  }
  if (!data?.token || !/^[a-f0-9]{64}$/.test(data.token)) throw new Error('The customer link could not be verified. Try again.')
  const relative = '/?approval=' + encodeURIComponent(data.token)
  return { ...data, relative_url: relative, url: new URL(relative, window.location.origin).toString() }
}

export async function getCustomerApproval(token: string) {
  const { data, error } = await supabase.functions.invoke('customer-approval', {
    body: { token, mode: 'view' },
  })
  if (error) {
    const detail = await error.context?.clone().json().catch(() => null)
    throw new Error(detail?.error || error.message)
  }
  return data
}

export async function submitCustomerApproval(token: string, action: 'approved' | 'declined', typedName: string, agreedToTerms = false, expectedRevisionId?: string) {
  const { data, error } = await supabase.functions.invoke('customer-approval', {
    body: { token, mode: action, typed_name: typedName.trim(), terms_agreed: agreedToTerms, ...(expectedRevisionId ? { expected_revision_id: expectedRevisionId } : {}) },
  })
  if (error) {
    const detail = await error.context?.clone().json().catch(() => null)
    throw new Error(detail?.error || error.message)
  }
  return data
}
