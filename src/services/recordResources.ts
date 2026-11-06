import { getStorageUsage, uploadAttachment, prepareRecordImage } from '../lib/businessStorage'
import { supabase } from '../lib/supabase'
import { asList } from './relations'
import { collectWorkbookPages } from '../lib/workbookPages'

export type RecordKind = 'job' | 'estimate' | 'invoice'
export type RecordTarget = { kind: RecordKind; id: string }
export const recordColumn = (kind: RecordKind) => ({ job: 'job_id', estimate: 'estimate_id', invoice: 'invoice_id' } as const)[kind]
export type RecordPhoto = { id: string; file_name: string; storage_path: string; created_by: string; created_at: string; url: string | null }
export type RecordExpense = { id: string; entry_date: string; amount: number | string; description: string; category: string; currency: string; receiptPath: string | null }
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
  const rows = await collectWorkbookPages((from, to) => supabase.from('bookkeeping_entries')
    .select('id,entry_date,amount,description,category,currency,record_photos!record_photos_expense_fk(storage_path)', { count: 'exact' })
    .eq('business_id', businessId).eq(recordColumn(target.kind), target.id)
    .eq('direction', 'expense').order('id').range(from, to))
  return rows.map(row => ({ ...row, receiptPath: asList(row.record_photos)[0]?.storage_path || null })) as RecordExpense[]
}

export async function uploadRecordPhoto(businessId: string, target: RecordTarget, file: File) {
  const blob = await prepareRecordImage(file)
  const usage = await getStorageUsage(businessId)
  if (blob.size > usage.remaining_bytes) throw new Error('Business storage allowance reached. Remove optional pictures to make room. Existing records and payments remain available.')
  const id = crypto.randomUUID(), path = `${businessId}/${id}.jpg`
  const { error: metadataError } = await supabase.from('record_photos').insert({
    id, business_id: businessId, [recordColumn(target.kind)]: target.id,
    file_name: file.name.slice(0, 240), byte_size: blob.size, media_type: 'image/jpeg',
  })
  if (metadataError) throw metadataError
  // Keep metadata on uncertain delivery so a committed photo remains discoverable.
  await uploadAttachment(bucket, path, blob)
}

export async function removeRecordPhoto(businessId: string, photo: Pick<RecordPhoto, 'id' | 'storage_path'>) {
  const { error } = await supabase.storage.from(bucket).remove([photo.storage_path])
  if (error) throw error
  const result = await supabase.from('record_photos').delete().eq('business_id', businessId).eq('id', photo.id).select('id')
  if (result.error) throw result.error
  if (!result.data?.length) throw new Error('Picture removal could not be confirmed. Refresh and check your access.')
}
