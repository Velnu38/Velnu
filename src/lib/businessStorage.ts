import { supabase } from './supabase'
export type StorageUsage = { plan: 'free' | 'basic' | 'pro'; used_bytes: number; pending_bytes: number; limit_bytes: number; remaining_bytes: number; file_count: number; logo_allowed: boolean; warning: 'none' | 'warning' | 'critical' | 'full' }
export const PHOTO_BYTES_LIMIT = 10_000_000
export const LOGO_BYTES_LIMIT = 2_000_000
export const storageSize = (bytes: number) => bytes >= 1_000_000_000 ? `${Number((bytes / 1_000_000_000).toFixed(2))} GB` : `${Number((bytes / 1_000_000).toFixed(2))} MB`
export async function getStorageUsage(businessId: string): Promise<StorageUsage> {
  const { data, error } = await supabase.rpc('get_business_storage_usage', { p_business_id: businessId })
  if (error) throw error
  if (!data || !Number.isFinite(data.limit_bytes) || data.limit_bytes <= 0 || !Number.isFinite(data.remaining_bytes)) throw new Error('Storage usage is temporarily unavailable.')
  return data as StorageUsage
}
export async function uploadAttachment(bucket: string, path: string, body: Blob) {
  const { error } = await supabase.functions.invoke(`upload-attachment?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`, { body, headers: { 'Content-Type': body.type } })
  if (error) {
    let message = 'Upload was not confirmed. Refresh before retrying.'
    try { const details = await error.context?.clone().json(); if (typeof details?.error === 'string') message = details.error } catch { /* retain a safe retry message */ }
    throw new Error(message)
  }
}

export async function prepareRecordImage(file: File, maxSide = 2400) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP picture.')
  if (!file.size || file.size > PHOTO_BYTES_LIMIT) throw new Error('Each picture must be between 1 byte and 10 MB.')
  // Decode and re-encode before persistence: rejects corrupt images and strips GPS/EXIF metadata.
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This picture could not be opened. Export it as JPG or PNG and try again.') })
  let blob: Blob
  try {
    if (bitmap.width * bitmap.height > 50_000_000) throw new Error('Choose a picture smaller than 50 megapixels.')
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser could not prepare the picture.')
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Unable to prepare picture.')), 'image/jpeg', 0.9))
  } finally { bitmap.close() }
  return blob
}
