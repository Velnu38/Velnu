import { supabase } from '../lib/supabase'

export type ReceiptFile = { name: string; blob: Blob }
export type ReceiptDraft = { vendor: string | null; date: string | null; total: string | null; tax: string | null; items: string[]; warning: string }

export async function scanReceipt(businessId: string, blob: Blob): Promise<ReceiptDraft> {
  const request = crypto.randomUUID()
  const { data, error } = await supabase.functions.invoke(`receipt-scan?business=${encodeURIComponent(businessId)}&request=${request}`, {
    body: blob, headers: { 'Content-Type': 'image/jpeg' },
  })
  if (error) {
    const details = await error.context?.clone().json().catch(() => null)
    throw new Error(details?.error || 'Unable to read the receipt. You can enter the details and save the photo.')
  }
  return data as ReceiptDraft
}

export async function getReceiptUrl(path: string) {
  const { data, error } = await supabase.storage.from('finviant-record-photos').createSignedUrl(path, 60)
  if (error || !data?.signedUrl) throw new Error('The receipt upload is pending or the photo is unavailable.')
  return data.signedUrl
}
