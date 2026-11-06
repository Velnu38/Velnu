import { uploadAttachment, LOGO_BYTES_LIMIT } from './businessStorage'
import { supabase } from './supabase'

export type BusinessRole = 'owner' | 'admin' | 'office' | 'technician' | 'viewer'

export interface BusinessProfile {
  created_by_user_id?: string
  timezone?: string
  id: string
  name: string
  legal_name: string | null
  email: string | null
  phone: string | null
  website: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  logo_path: string | null
  document_accent: string
  document_footer: string | null
  business_description: string | null
  services_offered: string | null
  service_area: string | null
  team_size: number | null
  team_roles: string | null
  profile_completed_at: string | null
}

export interface CurrentBusiness extends BusinessProfile {
  primary_owner?: boolean
  access_modules?: string[]
  role: BusinessRole
}

export interface BusinessProfileDraft {
  name: string
  legal_name: string
  email: string
  phone: string
  website: string
  address_line1: string
  address_line2: string
  city: string
  state: string
  postal_code: string
  document_accent: string
  document_footer: string
  business_description: string
  services_offered: string
  service_area: string
  team_size: string
  team_roles: string
}

export const emptyBusinessProfile: BusinessProfileDraft = {
  name: '', legal_name: '', email: '', phone: '', website: '',
  address_line1: '', address_line2: '', city: '', state: '', postal_code: '',
  document_accent: '#2563eb', document_footer: '',
  business_description: '', services_offered: '', service_area: '',
  team_size: '', team_roles: '',
}

const fields = 'id,created_by_user_id,timezone,name,legal_name,email,phone,website,address_line1,address_line2,city,state,postal_code,logo_path,document_accent,document_footer,business_description,services_offered,service_area,team_size,team_roles,profile_completed_at'

export function draftFromBusiness(business: BusinessProfile): BusinessProfileDraft {
  return {
    name: business.name || '', legal_name: business.legal_name || '',
    email: business.email || '', phone: business.phone || '', website: business.website || '',
    address_line1: business.address_line1 || '', address_line2: business.address_line2 || '',
    city: business.city || '', state: business.state || '', postal_code: business.postal_code || '',
    document_accent: business.document_accent || '#2563eb',
    document_footer: business.document_footer || '',
    business_description: business.business_description || '',
    services_offered: business.services_offered || '', service_area: business.service_area || '',
    team_size: business.team_size == null ? '' : String(business.team_size),
    team_roles: business.team_roles || '',
  }
}

function cleanProfile(draft: BusinessProfileDraft) {
  const name = draft.name.trim()
  if (!name) throw new Error('Company name is required.')
  if (name.length > 160) throw new Error('Company name is too long.')
  if (!/^#[0-9a-f]{6}$/i.test(draft.document_accent)) throw new Error('Choose a valid document accent color.')
  const team = draft.team_size.trim() === '' ? null : Number(draft.team_size)
  if (team !== null && (!Number.isInteger(team) || team < 0 || team > 10000)) throw new Error('Enter a valid team size.')
  const optional = (value: string) => value.trim() || null
  return {
    name,
    legal_name: optional(draft.legal_name), email: optional(draft.email),
    phone: optional(draft.phone), website: optional(draft.website),
    address_line1: optional(draft.address_line1), address_line2: optional(draft.address_line2),
    city: optional(draft.city), state: optional(draft.state), postal_code: optional(draft.postal_code),
    document_accent: draft.document_accent.toLowerCase(),
    document_footer: optional(draft.document_footer),
    business_description: optional(draft.business_description),
    services_offered: optional(draft.services_offered), service_area: optional(draft.service_area),
    team_size: team, team_roles: optional(draft.team_roles),
    profile_completed_at: new Date().toISOString(),
  }
}

export async function getCurrentBusiness(): Promise<CurrentBusiness | null> {
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!authData.user) return null

  let query = supabase.from('business_members')
    .select('business_id,role,access_modules,businesses(' + fields + ')').eq('user_id', authData.user.id)
  const selected = localStorage.getItem('finviant-active-business:' + authData.user.id)
  if (selected) query = query.eq('business_id', selected)
  const { data: membership, error: membershipError } = await query.order('created_at').limit(1).maybeSingle()
  if (membershipError) throw membershipError
  if (!membership) return null
  // The dynamic PostgREST projection cannot be inferred by the Supabase generic parser.
  const row = membership as unknown as { businesses: BusinessProfile | BusinessProfile[] | null; role: BusinessRole; access_modules: string[] }
  const record = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses
  if (!record) return null
  return { ...record, role: row.role, access_modules: row.access_modules ?? [], primary_owner: row.role === 'owner' && record.created_by_user_id === authData.user.id }
}

export async function createBusiness(draft: BusinessProfileDraft): Promise<CurrentBusiness> {
  const { data, error } = await supabase.from('businesses')
    .insert(cleanProfile(draft)).select(fields).single()
  if (error) throw error
  return { ...(data as BusinessProfile), role: 'owner', primary_owner: true, access_modules: ['calendar','jobs','billing','finances'] }
}

export async function updateBusinessProfile(business: CurrentBusiness, draft: BusinessProfileDraft, logoPath?: string | null): Promise<CurrentBusiness> {
  if (!business.primary_owner) throw new Error('Only the owner or administrator can change company settings.')
  const changes: Record<string, unknown> = cleanProfile(draft)
  if (logoPath !== undefined) changes.logo_path = logoPath
  const { data, error } = await supabase.from('businesses').update(changes)
    .eq('id', business.id).select(fields).single()
  if (error) throw error
  return { ...business, ...(data as BusinessProfile) }
}

export async function uploadBusinessLogo(business: CurrentBusiness, file: File): Promise<string> {
  if (!business.primary_owner) throw new Error('Only owners and administrators can upload logos.')
  const valid: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
  const extension = valid[file.type]
  if (!extension) throw new Error('Choose a PNG, JPG, or WebP logo.')
  if (file.size > LOGO_BYTES_LIMIT) throw new Error('The logo must be smaller than 2 MB.')
  if (file.size === 0) throw new Error('The image file is empty.')
  const path = business.id + '/logo-' + crypto.randomUUID() + '.' + extension
  await uploadAttachment('velnu-business-logos', path, file)
  return path
}

export function businessLogoUrl(profile: Pick<BusinessProfile, 'logo_path'>): string | null {
  if (!profile.logo_path) return null
  const { data } = supabase.storage.from('velnu-business-logos').getPublicUrl(profile.logo_path)
  return data.publicUrl
}

export function canWrite(role: BusinessRole) { return role !== 'viewer' }

/** Financial records are managed by owners, admins and office staff, not field technicians. */
export function canManageFinances(role: BusinessRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'office'
}
