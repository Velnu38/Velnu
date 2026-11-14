import { supabase } from '../lib/supabase'
import type { DeliveryDocumentKind } from './reviewDelivery'

export type DocumentPdfSource =
  | { businessId: string; kind: DeliveryDocumentKind; documentId: string }
  | { token: string; tokenType: 'share' | 'approval' }
export type DocumentPdfArtifact = { blob: Blob; filename: string; revisionId: string | null; etag: string | null }

function safeFilename(value: string) {
  const name = value.replace(/[\\/\r\n\u0000-\u001f]/g, '_').replace(/[^\p{L}\p{N}_. ()-]/gu, '_').slice(0, 160)
  return name.toLowerCase().endsWith('.pdf') ? name : (name || 'Finviant document') + '.pdf'
}

/** Fetch the stored publication; preview, download and sharing use these same bytes. */
export async function getDocumentPdf(source: DocumentPdfSource, signal?: AbortSignal): Promise<DocumentPdfArtifact> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }
  let body: Record<string, string>
  if ('token' in source) body = { token: source.token, token_type: source.tokenType }
  else {
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) throw new Error('Sign in again to open the document PDF.')
    headers.Authorization = 'Bearer ' + data.session.access_token
    body = { business_id: source.businessId, document_kind: source.kind, document_id: source.documentId }
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timeout = window.setTimeout(abort, 30000)
  try {
    const response = await fetch(import.meta.env.VITE_SUPABASE_URL + '/functions/v1/document-pdf', {
      method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store', signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => null)
      throw new Error(typeof detail?.error === 'string' ? detail.error : 'The PDF could not be opened. Reconnect and try again.')
    }
    if (!/^application\/pdf(?:;|$)/i.test(response.headers.get('Content-Type') || '')) throw new Error('The document service did not return a PDF. Try again before sending.')
    const blob = await response.blob()
    if (blob.size > 12 * 1024 * 1024 || blob.size < 5 || await blob.slice(0, 5).text() !== '%PDF-') throw new Error('The PDF could not be verified. Try again before sending.')
    const disposition = response.headers.get('Content-Disposition') || ''
    const filename = safeFilename(disposition.match(/filename="([^"]+)"/i)?.[1] || 'Finviant document.pdf')
    const revision = response.headers.get('X-Finviant-Revision-Id')
    if (!revision || !/^[a-f0-9-]{36}$/i.test(revision)) throw new Error('The PDF version could not be verified. Try again before sending or approving.')
    return { blob, filename, revisionId: revision && /^[a-f0-9-]{36}$/i.test(revision) ? revision : null, etag: response.headers.get('ETag') }
  } catch (failure) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('Opening the PDF timed out. Check your connection and try again.')
    throw failure
  } finally { window.clearTimeout(timeout); signal?.removeEventListener('abort', abort) }

}

export function downloadDocumentPdf(artifact: DocumentPdfArtifact) {
  const url = URL.createObjectURL(artifact.blob)
  const link = document.createElement('a')
  link.href = url; link.download = artifact.filename; document.body.appendChild(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export function canShareDocumentPdf(artifact: DocumentPdfArtifact) {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [new File([artifact.blob], artifact.filename, { type: 'application/pdf' })] })
  } catch { return false }
}

/** Call directly from a click, using an already loaded PDF, to preserve user activation. */
export async function shareDocumentPdf(artifact: DocumentPdfArtifact, title: string, text?: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!canShareDocumentPdf(artifact)) return 'unsupported'
  try {
    await navigator.share({ title, text, files: [new File([artifact.blob], artifact.filename, { type: 'application/pdf' })] })
    return 'shared'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    throw new Error('This device could not share the PDF. Download it and attach it in your email app.')
  }
}
