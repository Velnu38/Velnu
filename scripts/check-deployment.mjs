import { pathToFileURL } from 'node:url'

// This project is deliberately retained as staging, including its existing data.
export const STAGING_PROJECT_REF = 'xvybcmyoblfgzokaifsx'

export function validateDeploymentEnvironment(env) {
  const target = env.VERCEL_ENV
  if (!target && env.VERCEL !== '1') return { target: 'local', checked: false }
  if (!['production', 'preview', 'development'].includes(target)) {
    throw new Error('A recognized VERCEL_ENV is required for hosted builds')
  }
  const production = target === 'production'
  const expectedEnvironment = production ? 'production' : 'staging'
  if (env.FINVIANT_DEPLOYMENT_ENV !== expectedEnvironment) {
    throw new Error('FINVIANT_DEPLOYMENT_ENV does not match the Vercel target')
  }
  const ref = env.FINVIANT_SUPABASE_PROJECT_REF || ''
  if (!/^[a-z]{20}$/.test(ref)) throw new Error('A valid explicit Supabase project reference is required')
  if (production ? ref === STAGING_PROJECT_REF : ref !== STAGING_PROJECT_REF) {
    throw new Error('Production and staging must use separate registered Supabase projects')
  }
  if (env.VITE_SUPABASE_URL !== `https://${ref}.supabase.co`) {
    throw new Error('Supabase URL does not match the project registered for this environment')
  }
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('Hosted builds require a Supabase publishable key; secret and legacy JWT keys are not accepted')
  }
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('VITE_')) continue
    if (/(?:SECRET|SERVICE_ROLE|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN)/i.test(name)
        || /^(?:sb_secret_|sk_(?:live|test|proj)_|rk_(?:live|test)_)/.test(value || '')) {
      throw new Error('A privileged credential was configured as a browser-visible variable')
    }
  }
  if (!production && env.VITE_ENABLE_CUSTOMER_ACTIONS === 'true') {
    throw new Error('Customer delivery must remain disabled in shared staging deployments')
  }
  if (production) {
    const releaseBranch = env.FINVIANT_PRODUCTION_GIT_REF
    if (!releaseBranch || env.VERCEL_GIT_COMMIT_REF !== releaseBranch) {
      throw new Error('Production must build from the explicitly configured release branch')
    }
  }
  return { target, checked: true, projectRef: ref }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = validateDeploymentEnvironment(process.env)
    console.log(result.checked
      ? `Environment isolation checked: ${result.target}`
      : 'Local/CI build: hosted environment isolation is checked only on Vercel')
  } catch (error) {
    console.error(`Deployment blocked: ${error.message}`)
    process.exitCode = 1
  }
}
