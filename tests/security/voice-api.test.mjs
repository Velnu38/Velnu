import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHmac } from 'node:crypto'
import pg from 'pg'

const enabled = process.env.FINVIANT_VOICE_API_TESTS === 'local-disposable'
// Public synthetic test secret. Never load a hosted Supabase secret into this suite.
const signingKey = 'finviant-voice-local-only-jwt-secret-32-bytes-minimum'
const actor = '10000000-0000-4000-8000-000000000001'
const business = '20000000-0000-4000-8000-000000000001'
const foreignBusiness = '20000000-0000-4000-8000-000000000002'
const ownTranscript = '30000000-0000-4000-8000-000000000001'
const foreignTranscript = '30000000-0000-4000-8000-000000000002'
function token(claims = {}, key = signingKey) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ role: 'authenticated', sub: actor,
    exp: Math.floor(Date.now() / 1000) + 600, ...claims })).toString('base64url')
  return header + '.' + payload + '.' + createHmac('sha256', key).update(header + '.' + payload).digest('base64url')
}
test('direct PostgREST requests enforce transcript permissions and concurrent SQL quotas', { skip: !enabled, timeout: 90000 }, async t => {
  const databaseUrl = new URL(process.env.VOICE_TEST_DATABASE_URL || '')
  const restUrl = new URL(process.env.VOICE_TEST_REST_URL || '')
  // Refuse every hosted database/API, including both registered Supabase projects.
  assert(['127.0.0.1', 'localhost'].includes(databaseUrl.hostname))
  assert(databaseUrl.pathname === '/finviant_voice_test')
  assert(['postgres:', 'postgresql:'].includes(databaseUrl.protocol) && databaseUrl.search === '')
  assert(['127.0.0.1', 'localhost'].includes(restUrl.hostname) && restUrl.protocol === 'http:')
  assert(restUrl.pathname === '/' && restUrl.search === '' && !restUrl.username && !restUrl.password)
  const db = new pg.Client({ connectionString: databaseUrl.href })
  const file = name => readFile(new URL(name, import.meta.url), 'utf8')
  const subscriber = token({ user_metadata: { plan: 'pro', business_id: foreignBusiness } })
  async function api(path, { authorization = subscriber, method = 'GET', body, prefer } = {}) {
    const response = await fetch(new URL(path, restUrl), { method,
      headers: { ...(authorization ? { authorization: 'Bearer ' + authorization } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}), ...(prefer ? { prefer } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000), redirect: 'error' })
    const text = await response.text()
    return { status: response.status, data: text ? JSON.parse(text) : null }
  }
  async function denied(path, options, expected = 403) {
    const r = await api(path, options)
    assert.equal(r.status, expected, JSON.stringify({ path, status: r.status, data: r.data }))
    if (expected === 403) assert.equal(r.data.code, '42501')
  }
  await db.connect()
  try {
    // This database must be newly created and is discarded with the CI service.
    assert.equal((await db.query("select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")).rows[0].n, 0)
    await db.query(await file('./voice-test-infrastructure.sql'))
    await db.query(await file('../../supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql'))
    const checks = await file('./voice-rls.sql')
    const fixtures = checks.split('-- BEGIN VOICE FIXTURES\n')[1]?.split('-- END VOICE FIXTURES')[0]
    assert(fixtures, 'Shared fixture markers must exist')
    await db.query(fixtures)
    await db.query("notify pgrst, 'reload schema'")
    let ready = false
    for (let attempt = 0; attempt < 30; attempt++) {
      try { if ((await api('/voice_transcriptions?select=id')).status === 200) { ready = true; break } } catch { /* bounded startup wait */ }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    assert(ready, 'PostgREST must load the actual application schema')
    await t.test('anonymous, expired and incorrectly signed tokens are denied', async () => {
      await denied('/voice_transcriptions?select=id', { authorization: '' }, 401)
      await denied('/voice_transcriptions?select=id', { authorization: token({ exp: Math.floor(Date.now() / 1000) - 60 }) }, 401)
      await denied('/voice_transcriptions?select=id', { authorization: token({}, signingKey + '-forged') }, 401)
    })
    await t.test('positive own read and negative tenant/actor reads', async () => {
      const all = await api('/voice_transcriptions?select=id,transcript')
      assert.equal(all.status, 200)
      assert.deepEqual(all.data, [{ id: ownTranscript, transcript: 'QA_A_OWNER' }])
      for (const filter of ['id=eq.' + foreignTranscript, 'business_id=eq.' + foreignBusiness,
        'id=eq.30000000-0000-4000-8000-000000000003', 'id=eq.30000000-0000-4000-8000-000000000004']) {
        const r = await api('/voice_transcriptions?select=id&' + filter)
        assert.equal(r.status, 200); assert.deepEqual(r.data, [])
      }
    })
    await t.test('subscriber INSERT, PATCH, DELETE and UPSERT cannot forge stored transcripts', async () => {
      const forged = { id: ownTranscript, business_id: business, user_id: actor, transcript: 'forged', provider: 'openai' }
      await denied('/voice_transcriptions', { method: 'POST', body: { ...forged, id: undefined } })
      await denied('/voice_transcriptions', { method: 'POST', body: { ...forged, id: undefined, business_id: foreignBusiness } })
      await denied('/voice_transcriptions?id=eq.' + ownTranscript, { method: 'PATCH', body: { transcript: 'forged' } })
      await denied('/voice_transcriptions?id=eq.' + ownTranscript, { method: 'PATCH', body: { business_id: foreignBusiness } })
      await denied('/voice_transcriptions?id=eq.' + ownTranscript, { method: 'DELETE' })
      await denied('/voice_transcriptions?on_conflict=id', { method: 'POST', body: forged, prefer: 'resolution=merge-duplicates' })
      assert.equal((await db.query('select transcript from public.voice_transcriptions where id=$1', [ownTranscript])).rows[0].transcript, 'QA_A_OWNER')
      assert.equal((await db.query('select count(*)::int n from public.voice_transcriptions')).rows[0].n, 4)
    })
    await t.test('service role can persist a valid server transcript', async () => {
      const r = await api('/voice_transcriptions', { method: 'POST', authorization: token({ role: 'service_role' }),
        body: { business_id: business, user_id: actor, transcript: 'QA_SERVER_CANONICAL' }, prefer: 'return=representation' })
      assert.equal(r.status, 201); assert.equal(r.data[0].transcript, 'QA_SERVER_CANONICAL')
    })
    await t.test('foreign business and unactivated Pro cannot reserve attempts through RPC', async () => {
      await denied('/rpc/reserve_ai_provider_attempt', { method: 'POST', body: { p_business_id: foreignBusiness, p_kind: 'transcription' } })
      await denied('/rpc/reserve_ai_provider_attempt', { method: 'POST', body: { p_business_id: business, p_kind: 'transcription' } })
    })
    await db.query("insert into private.business_entitlements(business_id,plan,valid_until) values($1,'pro',now()+interval '1 day')", [business])
    await db.query("insert into private.finviant_ai_attempt_budget(business_id,period,kind,attempts,minute_attempts) values($1,date_trunc('month',now() at time zone 'UTC')::date,'transcription',49,0)", [business])
    async function concurrentReservations() {
      const results = await Promise.all(Array.from({ length: 20 }, () => api('/rpc/reserve_ai_provider_attempt', {
        method: 'POST', body: { p_business_id: business, p_kind: 'transcription' },
      })))
      assert.equal(results.filter(r => r.status === 200).length, 1)
      const refused = results.filter(r => r.status !== 200)
      assert.equal(refused.length, 19)
      assert(refused.every(r => r.data.code === 'P0001'), 'Only the quota guard may refuse competing requests')
    }
    await t.test('20 real simultaneous HTTP requests cannot overrun the final monthly allowance', async () => {
      await concurrentReservations()
      assert.equal((await db.query('select attempts from private.finviant_ai_attempt_budget where business_id=$1', [business])).rows[0].attempts, 50)
    })
    await t.test('20 real simultaneous HTTP requests cannot overrun the final minute allowance', async () => {
      await db.query('update private.finviant_ai_attempt_budget set attempts=0,minute_attempts=9,minute_start=now() where business_id=$1', [business])
      await concurrentReservations()
      assert.equal((await db.query('select minute_attempts from private.finviant_ai_attempt_budget where business_id=$1', [business])).rows[0].minute_attempts, 10)
    })
  } finally { await db.end() }
})
