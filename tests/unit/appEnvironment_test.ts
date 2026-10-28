import { resolveAppEnvironment } from '../../supabase/functions/_shared/appEnvironment.ts'
function assert(value: unknown): asserts value { if (!value) throw new Error('Environment isolation failed') }
const staging = 'https://xvybcmyoblfgzokaifsx.supabase.co'
const production = 'https://qusmeexjbwphoezlcmie.supabase.co'
Deno.test('production returns only production application origins', () => {
  const result = resolveAppEnvironment(production)!
  assert(result.name === 'production' && result.baseUrl === 'https://finviant.com')
  assert(result.origins.length === 2 && !result.origins.some(s => s.includes('vercel.app') || s.includes('localhost')))
})
Deno.test('staging callbacks return to the protected Finviant domain and its preview', () => {
  const result = resolveAppEnvironment(staging)!
  assert(result.name === 'staging' && result.baseUrl === 'https://finviant.com')
  assert(result.origins.includes('https://www.finviant.com'))
  assert(result.origins.some(s => s.includes('feature-velnu-stage1')))
})
Deno.test('unknown and missing backend configuration fail closed', () => {
  for (const url of [undefined, '', 'https://other.supabase.co', production + '/']) assert(resolveAppEnvironment(url) === null)
})
Deno.test('staging and production share only the verified domain, not backend projects', () => {
  const stageConfig = resolveAppEnvironment(staging, 'https://finviant.com')!
  const prodConfig = resolveAppEnvironment(production, 'https://finviant.com')!
  assert(stageConfig.name === 'staging' && prodConfig.name === 'production')
  assert(stageConfig.baseUrl === prodConfig.baseUrl)
  assert(resolveAppEnvironment(production, 'https://finviant-office-git-feature-velnu-stage1-mbarone5-1747.vercel.app') === null)
  assert(resolveAppEnvironment(staging, 'https://unknown.vercel.app') === null)
})
Deno.test('production permits its verified www origin', () => {
  assert(resolveAppEnvironment(production, 'https://www.finviant.com')?.baseUrl === 'https://www.finviant.com')
})
Deno.test('callback overrides reject paths, lookalikes, credentials and local origins', () => {
  for (const origin of ['https://finviant.com/evil','https://finviant.com.attacker.invalid','https://user@finviant.com','http://localhost:5173']) {
    assert(resolveAppEnvironment(production, origin) === null)
    assert(resolveAppEnvironment(staging, origin) === null)
  }
})
