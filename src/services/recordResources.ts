import { supabase } from '../lib/supabase'
import { collectWorkbookPages } from '../lib/workbookPages'

export type RecordKind = 'job' | 'estimate' | 'invoice'
export type RecordTarget = { kind: RecordKind; id: string }
export const recordColumn = (kind: RecordKind) => ({ job: 'job_id', estimate: 'estimate_id', invoice: 'invoice_id' } as const)[kind]
export type RecordPhoto = { id: string; file_name: string; storage_path: string; created_by: string; created_at: string; url: string | null }
export type RecordExpense = { id: string; entry_date: string; amount: number | string; description: string; category: string; currency: string }
const bucket = 'finviant-record-photos'

export async function listRecordPhotos(businessId: string, target: RecordTarget): Promise<RecordPhoto[]> {
  const rows = await collectWorkbookPages((from, to) => supabase.from('record_photos')
    .select('id,file_name,storage_path,created_by,created_at', { count: 'exact' })
    .eq('business_id', businessId).eq(recordColumn(target.kind), target.id).order('id').range(from, to))
  if (!rows.length) return []
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(rows.map(row => row.storage_path as string), 60)
  if (error) throw error
  const urls = new Map(data?.map(item => [item.path, item.signedUrl]))
  // An interrupted upload is visible and removable, not silently hidden.
  return rows.map(row => ({ ...row, url: urls.get(row.storage_path as string) || null })) as RecordPhoto[]
}

export async function listRecordExpenses(businessId: string, target: RecordTarget) {
  return await collectWorkbookPages((from, to) => supabase.from('bookkeeping_entries')
    .select('id,entry_date,amount,description,category,currency', { count: 'exact' })
    .eq('business_id', businessId).eq(recordColumn(target.kind), target.id)
    .eq('direction', 'expense').order('id').range(from, to)) as RecordExpense[]
}

export async function uploadRecordPhoto(businessId: string, target: RecordTarget, file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP picture.')
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Each picture must be between 1 byte and 10 MB.')
  // Decode and re-encode before persistence: rejects corrupt images and strips GPS/EXIF metadata.
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This picture could not be opened. Export it as JPG or PNG and try again.') })
  let blob: Blob
  try {
    if (bitmap.width * bitmap.height > 50_000_000) throw new Error('Choose a picture smaller than 50 megapixels.')
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser could not prepare the picture.')
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Unable to prepare picture.')), 'image/jpeg', 0.9))
  } finally { bitmap.close() }
  const id = crypto.randomUUID(), path = `${businessId}/${id}.jpg`
  const { error: metadataError } = await supabase.from('record_photos').insert({
    id, business_id: businessId, [recordColumn(target.kind)]: target.id,
    file_name: file.name.slice(0, 240), byte_size: blob.size, media_type: 'image/jpeg',
  })
  if (metadataError) throw metadataError
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) {
    // Remove a possibly committed object first. Keep metadata if cleanup fails so the user can retry removal.
    try { await removeRecordPhoto(businessId, { id, storage_path: path }) } catch { /* visible on refresh */ }
    throw new Error('Picture upload was not confirmed. Refresh the photos before trying again.')
  }
}

export async function removeRecordPhoto(businessId: string, photo: Pick<RecordPhoto, 'id' | 'storage_path'>) {
  const { error } = await supabase.storage.from(bucket).remove([photo.storage_path])
  if (error) throw error
  const result = await supabase.from('record_photos').delete().eq('business_id', businessId).eq('id', photo.id).select('id')
  if (result.error) throw result.error
  if (!result.data?.length) throw new Error('Picture removal could not be confirmed. Refresh and check your access.')
}
