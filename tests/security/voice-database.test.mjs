import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('actual PostgreSQL privileges, transcript RLS and quota RPCs reject subscriber attacks', async () => {
  const db = new PGlite()
  try {
    // Supply only the Supabase-managed infrastructure the app schema references.
    // This runs the repository's entire app migration and its real RLS/functions,
    // not a reimplementation of its policies. HTTP/Auth JWT verification is separate.
    await db.exec(await readFile(new URL('./voice-test-infrastructure.sql', import.meta.url), 'utf8'))
    let bootstrap = await readFile(new URL('../../supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql', import.meta.url), 'utf8')
    // PGlite has no pgcrypto extension; voice uses PG's built-in gen_random_uuid.
    // No pgcrypto-dependent app function is exercised by this suite.
    bootstrap = bootstrap.replace('create extension if not exists pgcrypto with schema extensions;', '')
    await db.exec(bootstrap)
    const sql = await readFile(new URL('./voice-rls.sql', import.meta.url), 'utf8')
    await db.exec(sql)
    assert.equal((await db.query('select count(*)::int as n from public.voice_transcriptions')).rows[0].n, 0,
      'All synthetic fixtures are rolled back')
  } finally { await db.close() }
})
