import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = (await readFile('supabase/functions/customer-approval/index.ts', 'utf8')).replace(/^import .*;\r?$/gm, '')
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const token = 'ab'.repeat(32)
const revision = '88888888-8888-4888-8888-000000000011'

function endpoint(reply: (name: string, args: Record<string, unknown>) => unknown = () => ({ data: {}, error: null }), configured = true) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  let tableCalls = 0
  let handler!: (request: Request) => Promise<Response>
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return reply(name, args) },
    from: () => { tableCalls++; throw new Error('Customer handlers must use the canonical token RPC') },
  }
  vm.runInNewContext(javascript, {
    Deno: {
      env: { get: (name: string) => name === 'SUPABASE_URL' ? 'https://test.supabase.invalid' : configured ? 'test-server-key' : undefined },
      serve: (callback: typeof handler) => { handler = callback },
    },
    createClient: () => client,
    crypto: webcrypto, TextEncoder, Request, Response,
    console: { error() {} },
  })
  return {
    calls, tableCalls: () => tableCalls,
    invoke: (input: unknown, userAgent = 'test browser') => handler(new Request('https://test.supabase.invalid/functions/v1/customer-approval', {
      method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': userAgent }, body: JSON.stringify(input),
    })),
    request: (method: string) => handler(new Request('https://test.supabase.invalid/functions/v1/customer-approval', { method })),
  }
}

test('anonymous view returns the canonical immutable document RPC response without table reads', async () => {
  const document = { revision_id: revision, snapshot: { number: 'EST-1', total: 125, company: { document_footer: 'Frozen terms' } }, action_state: 'expired' }
  const app = endpoint(() => ({ data: document, error: null }))
  const response = await app.invoke({ token, mode: 'view' })
  assert.equal(response.status, 200, 'an expired action still has a readable document')
  assert.deepEqual(await response.json(), document)
  assert.equal(app.calls.length, 1)
  assert.equal(app.calls[0].name, 'get_customer_approval_document')
  assert.deepEqual({ ...app.calls[0].args }, { p_token: token })
  assert.equal(app.tableCalls(), 0)
})

test('approval forwards the viewed revision, hashed token, bounded user agent, and explicit consent exactly once', async () => {
  const result = { action: 'approved', already_consumed: true, revision_id: revision }
  const app = endpoint(() => ({ data: result, error: null }))
  const response = await app.invoke({ token, mode: 'approved', typed_name: '  Jordan Customer  ', terms_agreed: true, expected_revision_id: revision }, 'browser'.repeat(100))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), result)
  assert.equal(app.calls.length, 1, 'a recorded/idempotent response never causes a second mutation')
  const { name, args } = app.calls[0]
  assert.equal(name, 'consume_document_approval')
  assert.equal(args.p_token_hash, createHash('sha256').update(token).digest('hex'))
  assert.notEqual(args.p_token_hash, token)
  assert.equal(args.p_expected_revision_id, revision)
  assert.equal(args.p_action, 'approved')
  assert.equal(args.p_typed_name, 'Jordan Customer')
  assert.equal(args.p_terms_agreed, true)
  assert.equal((args.p_user_agent as string).length, 500)
  assert.equal(app.tableCalls(), 0)
})

test('legacy decisions omit a missing revision and string consent never becomes true', async () => {
  const app = endpoint()
  assert.equal((await app.invoke({ token, mode: 'declined', typed_name: 'Jordan Customer', terms_agreed: 'true' })).status, 200)
  assert.equal(Object.hasOwn(app.calls[0].args, 'p_expected_revision_id'), false)
  assert.equal(app.calls[0].args.p_terms_agreed, false)
})

test('invalid token, action, name, or UUID shape is rejected before database work', async () => {
  const valid = { token, mode: 'approved', typed_name: 'Jordan Customer', expected_revision_id: revision }
  const inputs = [
    { ...valid, token: 'short' }, { ...valid, token: 'a'.repeat(201) }, { ...valid, mode: 'paid' },
    { ...valid, typed_name: 'J' }, { ...valid, typed_name: 'J'.repeat(201) },
    ...[123, {}, 'not-a-uuid', '-'.repeat(36), 'a'.repeat(36)].map(expected_revision_id => ({ ...valid, expected_revision_id })),
  ]
  for (const input of inputs) {
    const app = endpoint()
    assert.equal((await app.invoke(input)).status, 400, JSON.stringify(input))
    assert.equal(app.calls.length, 0)
    assert.equal(app.tableCalls(), 0)
  }
})

test('view failures distinguish missing/revoked access while hiding internal database details', async () => {
  for (const [message, status] of [
    ['Approval link not found', 404], ['Approval link has been revoked', 410],
    ['Document unavailable', 410], ['PRIVATE_DATABASE_DETAIL', 503],
  ] as const) {
    const app = endpoint(() => ({ data: null, error: { message, code: 'private-code' } }))
    const response = await app.invoke({ token, mode: 'view' })
    assert.equal(response.status, status)
    assert.doesNotMatch(JSON.stringify(await response.json()), /PRIVATE_DATABASE_DETAIL|private-code/)
    assert.equal(app.calls.length, 1)
    assert.equal(app.tableCalls(), 0)
  }
})

test('decision failures preserve expiry, entitlement, revision, and consent distinctions', async () => {
  for (const [message, status] of [
    ['LINK_EXPIRED', 410], ['LINK_REVOKED', 410], ['LINK_NOT_FOUND', 404],
    ['TERMS_NOT_ACCEPTED', 400], ['PRO_ACTION_REQUIRED', 403], ['DOCUMENT_SUPERSEDED', 409],
    ['DOCUMENT_NOT_APPROVABLE', 409], ['PRIVATE_DATABASE_DETAIL', 409],
  ] as const) {
    const app = endpoint(() => ({ data: null, error: { message, code: 'private-code' } }))
    const response = await app.invoke({ token, mode: 'approved', typed_name: 'Jordan Customer', terms_agreed: true, expected_revision_id: revision })
    assert.equal(response.status, status, message)
    assert.doesNotMatch(JSON.stringify(await response.json()), /PRIVATE_DATABASE_DETAIL|private-code/)
    assert.equal(app.calls.length, 1)
  }
})

test('preflight, unsupported methods, and missing service configuration never contact the database', async () => {
  const app = endpoint()
  assert.equal((await app.request('OPTIONS')).status, 200)
  assert.equal((await app.request('GET')).status, 405)
  assert.equal(app.calls.length, 0)
  const unconfigured = endpoint(undefined, false)
  assert.equal((await unconfigured.invoke({ token, mode: 'view' })).status, 503)
  assert.equal(unconfigured.calls.length, 0)
})
