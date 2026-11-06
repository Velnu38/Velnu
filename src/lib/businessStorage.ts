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
