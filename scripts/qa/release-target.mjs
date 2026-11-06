import { isIsolatedQaProjectRef } from '../check-deployment.mjs'

function httpsOrigin(value, variable) {
  let url
  try { url = new URL(value) } catch { throw new Error(variable + ' must be an HTTPS origin') }
  if (url.protocol !== 'https:' || (value !== url.origin && value !== url.origin + '/')) {
    throw new Error(variable + ' must be an HTTPS origin without a path, query, or credentials')
  }
  return url
}

export function readReleaseQaTarget(env = process.env) {
  const preview = httpsOrigin(env.FINVIANT_QA_PREVIEW_URL, 'FINVIANT_QA_PREVIEW_URL')
  const database = httpsOrigin(env.FINVIANT_QA_SUPABASE_URL, 'FINVIANT_QA_SUPABASE_URL')
  if (!preview.hostname.endsWith('.vercel.app') || preview.port) {
    throw new Error('Use an immutable deployment URL from the separate Vercel QA project')
  }
  if (database.port || !database.hostname.endsWith('.supabase.co')
      || !isIsolatedQaProjectRef(database.hostname.slice(0, -'.supabase.co'.length))) {
    throw new Error('Use an isolated Supabase QA project outside the shared staging and production projects')
  }
  const business = env.FINVIANT_QA_BUSINESS?.trim()
  const outsiderBusiness = env.FINVIANT_QA_OUTSIDER_BUSINESS?.trim()
  if (!business?.startsWith('Finviant QA ')) throw new Error('FINVIANT_QA_BUSINESS must name a dedicated Finviant QA workspace')
  const bypass = env.FINVIANT_QA_VERCEL_BYPASS_SECRET
  if (!bypass) throw new Error('FINVIANT_QA_VERCEL_BYPASS_SECRET is required for the protected preview')
  const accounts = {}
  for (const role of ['owner', 'office', 'technician', 'outsider']) {
    const prefix = 'FINVIANT_QA_' + role.toUpperCase()
    const email = env[prefix + '_EMAIL']?.trim()
    const password = env[prefix + '_PASSWORD']
    if (!email || !password) throw new Error('Configure both ' + prefix + '_EMAIL and ' + prefix + '_PASSWORD')
    accounts[role] = { email, password }
  }
  if (!outsiderBusiness?.startsWith('Finviant QA ') || outsiderBusiness === business) {
    throw new Error('FINVIANT_QA_OUTSIDER_BUSINESS must name a different dedicated Finviant QA workspace')
  }
  if (new Set(Object.values(accounts).map(({ email }) => email.toLowerCase())).size !== Object.keys(accounts).length) {
    throw new Error('Each QA role needs a separate login')
  }
  return { preview: preview.origin, database: database.origin, business, outsiderBusiness, bypass, accounts }
}
