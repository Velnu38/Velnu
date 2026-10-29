import { resolveAppEnvironment } from '../../supabase/functions/_shared/appEnvironment.ts'
function assert(value: unknown): asserts value { if (!value) throw new Error('Environment isolation failed') }
const staging = 'https://xvybcmyoblfgzokaifsx.supabase.co'
const production = 'https://qusmeexjbwphoezlcmie.supabase.co'
Deno.test('production returns only production application origins', () => {
  const result = resolveAppEnvironment(production)!
  assert(result.name === 'production' && result.baseUrl === 'https://finviant.com')
  assert(result.origins.length === 2 && !result.origins.some(s => s.includes('vercel.app') || s.includes('localhost')))
})
Deno.test('staging callbacks stay on staging', () => {
  const result = resolveAppEnvironment(staging)!
  assert(result.name === 'staging' && result.baseUrl.includes('feature-velnu-stage1'))
  assert(!result.origins.includes('https://finviant.com'))
})
Deno.test('unknown and missing backend configuration fail closed', () => {
  for (const url of [undefined, '', 'https://other.supabase.co', production + '/']) assert(resolveAppEnvironment(url) === null)
})
Deno.test('cross-environment callback overrides are rejected', () => {
  assert(resolveAppEnvironment(staging, 'https://finviant.com') === null)
  assert(resolveAppEnvironment(production, resolveAppEnvironment(staging)!.baseUrl) === null)
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
