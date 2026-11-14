import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { readLimitedRequest } from '../../supabase/functions/_shared/signedEvents.ts'

const source = (await readFile('supabase/functions/create-approval-link/index.ts', 'utf8')).replace(/^import .*;\r?$/gm, '')
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const business = '11111111-1111-4111-8111-111111111111', document = '88888888-8888-4888-8888-000000000011'
const valid = { business_id: business, document_type: 'estimate', document_id: document }

function endpoint({ authenticated = true, result = { data: { token: 'safe-test-token', revision_id: document }, error: null } }: { authenticated?: boolean; result?: any } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const clientOptions: any[] = []
  let tableCalls = 0, authCalls = 0
  let handler!: (request: Request) => Promise<Response>
  vm.runInNewContext(javascript, {
    Deno: {
      env: { get: (name: string) => name === 'SUPABASE_URL' ? 'https://test.supabase.invalid' : 'test-anon-key' },
      serve: (callback: typeof handler) => { handler = callback },
    },
    createClient: (_url: string, _key: string, options: unknown) => {
      clientOptions.push(options)
      return {
        auth: { getUser: async () => { authCalls++; return { data: { user: authenticated ? { id: document } : null }, error: null } } },
        rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return result },
        from: () => { tableCalls++; throw new Error('Issuer must use one atomic RPC') },
      }
    },
    Request, Response, Error, readLimitedRequest, console: { error() {} },
  })
  return {
    calls, clientOptions, tableCalls: () => tableCalls, authCalls: () => authCalls,
    invoke: (input: unknown, auth = true) => handler(new Request('https://test.supabase.invalid/functions/v1/create-approval-link', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer test-owner-session' } : {}) }, body: JSON.stringify(input),
    })),
    request: (method: string) => handler(new Request('https://test.supabase.invalid/functions/v1/create-approval-link', { method })),
  }
}

test('issuer authenticates the owner before making one canonical atomic RPC', async () => {
  const app = endpoint()
  const response = await app.invoke(valid)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(app.authCalls(), 1)
  assert.equal(app.calls.length, 1)
  assert.equal(app.clientOptions[0].global.headers.Authorization, 'Bearer test-owner-session')
  assert.equal(app.calls[0].name, 'issue_document_approval_link')
  assert.deepEqual({ ...app.calls[0].args }, { p_business: business, p_kind: 'estimate', p_document: document, p_rotate: false })
  assert.equal(app.tableCalls(), 0)
})

test('old expires_days is ignored and rotation requires an explicit boolean true', async () => {
  for (const [rotate, expected] of [[undefined, false], [false, false], ['true', false], [true, true]] as const) {
    const app = endpoint()
    assert.equal((await app.invoke({ ...valid, expires_days: 1, rotate })).status, 200)
    assert.equal(app.calls[0].args.p_rotate, expected)
    assert.equal(Object.hasOwn(app.calls[0].args, 'expires_days'), false)
    assert.equal(Object.keys(app.calls[0].args).length, 4)
    assert.equal(app.tableCalls(), 0)
  }
})

test('missing or invalid sessions and invalid document input do not reach the issuer RPC', async () => {
  const missing = endpoint()
  assert.equal((await missing.invoke(valid, false)).status, 401)
  assert.equal(missing.clientOptions.length, 0)
  const invalid = endpoint({ authenticated: false })
  assert.equal((await invalid.invoke(valid)).status, 401)
  assert.equal(invalid.calls.length, 0)
  for (const input of [{ ...valid, business_id: '' }, { ...valid, document_id: '' }, { ...valid, document_type: 'invoice' }]) {
    const app = endpoint()
    assert.equal((await app.invoke(input)).status, 400)
    assert.equal(app.calls.length, 0)
    assert.equal(app.tableCalls(), 0)
  }
})

test('issuer surfaces access/conflict outcomes and hides unexpected database details', async () => {
  for (const [code, status] of [['42501', 403], ['23514', 409], ['23505', 409], ['XX000', 503]] as const) {
    const app = endpoint({ result: { data: null, error: { code, message: code === 'XX000' ? 'PRIVATE_DATABASE_DETAIL' : 'Review this document before issuing approval' } } })
    const response = await app.invoke(valid)
    assert.equal(response.status, status)
    assert.doesNotMatch(JSON.stringify(await response.json()), /PRIVATE_DATABASE_DETAIL/)
    assert.equal(app.calls.length, 1)
    assert.equal(app.tableCalls(), 0)
  }
})

test('issuer preflight and unsupported methods never create a client or change a link', async () => {
  const app = endpoint()
  assert.equal((await app.request('OPTIONS')).status, 200)
  assert.equal((await app.request('GET')).status, 405)
  assert.equal(app.clientOptions.length, 0)
  assert.equal(app.calls.length, 0)
})

test('issuer rejects oversized input before the atomic issuing RPC', async () => {
  const app = endpoint()
  assert.equal((await app.invoke({ ...valid, padding: 'x'.repeat(4096) })).status, 400)
  assert.equal(app.calls.length, 0)
})
