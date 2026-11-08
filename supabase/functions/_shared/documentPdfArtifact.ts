import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4'
import type { CanonicalDocumentSnapshot, DocumentPdfOptions } from '../../../shared/documentPdf.ts'

export const DOCUMENT_PDF_BUCKET = 'finviant-document-pdfs'
export const DOCUMENT_PDF_MAX_BYTES = 8_000_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type DocumentVersionContext = {
  version_id: string; business_id: string; kind: 'invoice'|'estimate'|'change_order'; document_id: string
  snapshot: CanonicalDocumentSnapshot; pdf_bucket?: string|null; pdf_path?: string|null
  pdf_sha256?: string|null; pdf_byte_size?: number|null
}
export type StoredDocumentPdf = { bytes: Uint8Array; sha256: string; filename: string; versionId: string }

export function documentPdfPath(version: DocumentVersionContext) {
  if (![version.version_id, version.business_id, version.document_id].every(id => UUID.test(id)) || !['invoice','estimate','change_order'].includes(version.kind)) throw new Error('INVALID_DOCUMENT_VERSION')
  return `${version.business_id}/${version.kind}/${version.document_id}/${version.version_id}.pdf`
}
export function documentPdfFilename(snapshot: { kind?: unknown; number?: unknown }) {
  const kind = snapshot.kind === 'change_order' ? 'Change-order' : snapshot.kind === 'estimate' ? 'Estimate' : 'Invoice'
  const number = String(snapshot.number || '').replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^[.-]+/, '').slice(0, 75)
  return `${kind}${number ? '-'+number : ''}.pdf`
}
export async function pdfSha256(bytes: Uint8Array) {
  const owned = new Uint8Array(bytes.byteLength); owned.set(bytes)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer))
  return Array.from(digest, value => value.toString(16).padStart(2,'0')).join('')
}
export function pdfBase64(bytes: Uint8Array) {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768))
  return btoa(binary)
}
function validPdf(bytes: Uint8Array) { return bytes.length > 8 && bytes.length <= DOCUMENT_PDF_MAX_BYTES && new TextDecoder().decode(bytes.subarray(0,5)) === '%PDF-' }

/** Only fixed private buckets and business-prefixed paths are read, never supplied URLs. */
async function versionLogo(admin: SupabaseClient, version: DocumentVersionContext): Promise<DocumentPdfOptions['logo']> {
  const path = version.snapshot.company?.logo_path
  if (!path) return undefined
  if (typeof path !== 'string' || !path.startsWith(version.business_id+'/') || path.length > 200 || path.includes('..') || !/^[A-Za-z0-9_./-]+$/.test(path)) throw new Error('INVALID_DOCUMENT_LOGO_PATH')
  const {data,error} = await admin.storage.from('velnu-business-logos').download(path)
  if (error || !data || data.size > 2_000_000) throw new Error('DOCUMENT_LOGO_UNAVAILABLE')
  const bytes = new Uint8Array(await data.arrayBuffer())
  if ([137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)) return {bytes,mimeType:'image/png'}
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return {bytes,mimeType:'image/jpeg'}
  throw new Error('DOCUMENT_LOGO_FORMAT_UNSUPPORTED')
}

/** Every viewer and email reads the same immutable object. Never overwrite it. */
export async function ensureStoredDocumentPdf(admin: SupabaseClient, versionId: string): Promise<StoredDocumentPdf> {
  if (!UUID.test(versionId)) throw new Error('INVALID_DOCUMENT_VERSION')
  const {data:version,error} = await admin.rpc('document_pdf_artifact_context', {p_version:versionId}).abortSignal(AbortSignal.timeout(5000))
  if (error || !version) throw new Error('DOCUMENT_VERSION_UNAVAILABLE')
  const context = version as DocumentVersionContext
  if (context.version_id !== versionId) throw new Error('DOCUMENT_VERSION_SCOPE_MISMATCH')
  const path = documentPdfPath(context)
  if ((context.pdf_bucket && context.pdf_bucket !== DOCUMENT_PDF_BUCKET) || (context.pdf_path && context.pdf_path !== path)) throw new Error('INVALID_DOCUMENT_PDF_PATH')
  const cached = await admin.storage.from(DOCUMENT_PDF_BUCKET).download(path)
  if (!cached.error && cached.data) {
    if (cached.data.size > DOCUMENT_PDF_MAX_BYTES) throw new Error('DOCUMENT_PDF_TOO_LARGE')
    const bytes = new Uint8Array(await cached.data.arrayBuffer()), sha256 = await pdfSha256(bytes)
    if (!validPdf(bytes) || (context.pdf_sha256 && sha256 !== context.pdf_sha256)) throw new Error('DOCUMENT_PDF_INTEGRITY_FAILED')
    const registration = await admin.rpc('register_document_pdf_artifact', {p_version:versionId,p_sha256:sha256,p_byte_size:bytes.length}).abortSignal(AbortSignal.timeout(5000))
    if (registration.error) throw new Error('DOCUMENT_PDF_REGISTRATION_FAILED')
    return {bytes,sha256,filename:documentPdfFilename(context.snapshot),versionId}
  }
  const {generateDocumentPdf} = await import('../../../shared/documentPdf.ts')
  const logo = await versionLogo(admin,context)
  const bytes = await generateDocumentPdf(context.snapshot,{logo}), sha256 = await pdfSha256(bytes)
  if (!validPdf(bytes)) throw new Error('DOCUMENT_PDF_RENDER_FAILED')
  if (context.pdf_sha256 && sha256 !== context.pdf_sha256) throw new Error('DOCUMENT_PDF_INTEGRITY_FAILED')
  const reservation = await admin.rpc('reserve_document_pdf_artifact',{p_version:versionId,p_byte_size:bytes.length}).abortSignal(AbortSignal.timeout(5000))
  if (reservation.error) throw new Error(reservation.error.message === 'PDF_STORAGE_ALLOWANCE_REACHED' ? 'PDF_STORAGE_ALLOWANCE_REACHED' : 'DOCUMENT_PDF_RESERVATION_FAILED')
  const uploaded = await admin.storage.from(DOCUMENT_PDF_BUCKET).upload(path,bytes,{contentType:'application/pdf',upsert:false,cacheControl:'0'})
  if (uploaded.error) {
    // Another request may have published the exact same object first.
    const concurrent = await admin.storage.from(DOCUMENT_PDF_BUCKET).download(path)
    if (concurrent.error || !concurrent.data || concurrent.data.size > DOCUMENT_PDF_MAX_BYTES || await pdfSha256(new Uint8Array(await concurrent.data.arrayBuffer())) !== sha256) throw new Error('DOCUMENT_PDF_SAVE_UNCONFIRMED')
  }
  const registration = await admin.rpc('register_document_pdf_artifact',{p_version:versionId,p_sha256:sha256,p_byte_size:bytes.length}).abortSignal(AbortSignal.timeout(5000))
  if (registration.error) throw new Error('DOCUMENT_PDF_REGISTRATION_FAILED')
  return {bytes,sha256,filename:documentPdfFilename(context.snapshot),versionId}
}

export async function prepareQueuedDocumentPdf(admin: SupabaseClient, claim: {id:string;lease:string;document_version_id?:string|null;payload:Record<string,unknown>}) {
  if (!claim.document_version_id) return claim.payload // Legacy queued operations retain their original frozen payload.
  if (Array.isArray(claim.payload.attachments) && claim.payload.attachments.length) return claim.payload
  const artifact = await ensureStoredDocumentPdf(admin,claim.document_version_id)
  const frozen = await admin.rpc('freeze_document_email_attachment',{
    p_request:claim.id,p_lease:claim.lease,p_version:artifact.versionId,
    p_filename:artifact.filename,p_content:pdfBase64(artifact.bytes),p_sha256:artifact.sha256,
  }).abortSignal(AbortSignal.timeout(10000))
  if (frozen.error || !frozen.data || !Array.isArray(frozen.data.attachments) || !frozen.data.attachments.length) throw new Error('DOCUMENT_PDF_PAYLOAD_NOT_FROZEN')
  return frozen.data as Record<string,unknown>
}
