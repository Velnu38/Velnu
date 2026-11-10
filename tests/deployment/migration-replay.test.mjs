import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localDatabaseUrl, migrationManifest, requireEmptyPlatform, safeDatabaseError } from '../../scripts/qa/replay-migrations.mjs'

test('replay refuses hosted, ambiguous or redirected database connections', () => {
  assert.equal(localDatabaseUrl('postgresql://postgres:local@127.0.0.1:54322/postgres'), 'postgresql://postgres:local@127.0.0.1:54322/postgres')
  for (const value of [
    'postgresql://postgres:local@db.xvybcmyoblfgzokaifsx.supabase.co:54322/postgres',
    'postgresql://postgres:local@localhost:54322/postgres',
    'postgresql://postgres:local@127.0.0.1:5432/postgres',
    'postgresql://postgres:local@127.0.0.1:54322/live',
    'postgresql://postgres:local@127.0.0.1:54322/postgres?host=remote',
    'postgresql://postgres:local@127.0.0.1:54322/postgres#remote',
    'https://127.0.0.1:54322/postgres',
  ]) assert.throws(() => localDatabaseUrl(value))
})

test('replay refuses fixtures that omit managed schemas or contain existing application data', async () => {
  for (const state of [
    { auth: false, storage: true, empty_application: true, empty_public: true },
    { auth: true, storage: false, empty_application: true, empty_public: true },
    { auth: true, storage: true, empty_application: false, empty_public: false },
  ]) await assert.rejects(requireEmptyPlatform({ query: async () => ({ rows: [state] }) }))
  let calls = 0
  await assert.rejects(requireEmptyPlatform({ query: async () => ({ rows: [++calls === 1
    ? { auth: true, storage: true, empty_application: true, empty_public: true }
    : { users: 1, objects: 0 }] }) }))
})

test('migration inventory rejects duplicate versions instead of silently skipping SQL', () => {
  const directory = mkdtempSync(join(tmpdir(), 'finviant-manifest-'))
  try {
    writeFileSync(join(directory, '20261110000000_one.sql'), 'select 1;\n')
    assert.equal(migrationManifest(directory)[0].sql, 'select 1;\n')
    writeFileSync(join(directory, '20261110000000_two.sql'), 'select 2;')
    assert.throws(() => migrationManifest(directory), /duplicate/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('public replay errors exclude row values, credentials and SQL context', () => {
  assert.deepEqual(safeDatabaseError({ code: '23505', message: 'secret@example.test already exists', detail: 'credentials', where: 'SQL secret', table: 'customers' }), { code: '23505', table: 'customers' })
  assert.deepEqual(safeDatabaseError({ code: '42P01', message: 'relation "public.missing" does not exist' }), { code: '42P01', message: 'relation "public.missing" does not exist' })
})
