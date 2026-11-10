import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

export function ownedReplayContainer(projectId) {
  if (!/^finviant-replay-[0-9a-f]{8}$/.test(projectId)) throw Error('Restore requires an owned disposable replay container')
  return `supabase_db_${projectId}`
}

const quote = value => '"' + value.replaceAll('"', '""') + '"'
const digest = value => createHash('sha256').update(value).digest('hex')

// Deliberately not a hosted recovery command. The caller has just created the
// empty local platform and its synthetic identities. Backups stay in memory.
export async function verifySyntheticRestore(db, { projectId, expectedUsers, expectedBusinesses, removeFile, restoreFile, verifyFile }) {
  const container = ownedReplayContainer(projectId)
  assert.equal(db.connectionParameters.host, '127.0.0.1')
  assert.equal(Number(db.connectionParameters.port), 54322)
  assert.equal(db.connectionParameters.database, 'postgres')
  const state = (await db.query(`select
    (select array_agg(id::text order by id) from auth.users) users,
    (select array_agg(id::text order by id) from public.businesses) businesses,
    (select count(*)::int from storage.objects) files,
    not exists(select 1 from vault.secrets) empty_vault,
    not exists(select 1 from private.tier_worker_config where enabled or endpoint is not null) delivery_disabled,
    current_setting('cron.launch_active_jobs') cron`)).rows[0]
  assert.deepEqual(state.users, [...expectedUsers].sort())
  assert.deepEqual(state.businesses, [...expectedBusinesses].sort())
  assert.equal(state.files, 1)
  assert.equal(state.empty_vault, true)
  assert.equal(state.delivery_disabled, true)
  assert.equal(state.cron, 'off')
  const tables = (await db.query(`select n.nspname schema,c.relname name from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in('r','p') and not c.relispartition and
    (n.nspname in('public','private') or (n.nspname='auth' and c.relname in('users','identities')))
    order by n.nspname,c.relname`)).rows
  assert.ok(tables.length > 50)
  const names = tables.map(t => quote(t.schema)+'.'+quote(t.name))
  async function snapshot() {
    const result = []
    for (const name of names) {
      const { rows } = await db.query(`select to_jsonb(t)::text row from ${name} t order by to_jsonb(t)::text limit 50001`)
      assert.ok(rows.length <= 50000, 'Synthetic restore refuses an unexpectedly large fixture')
      result.push({ table: name, count: rows.length, sha256: digest(JSON.stringify(rows)) })
    }
    return result
  }
  const run = (program, args, input) => {
    const result = spawnSync('docker', ['exec', ...(input ? ['-i'] : []), container, program, ...args], {
      input, timeout: 60000, maxBuffer: 64 * 1024 * 1024,
    })
    if (result.status !== 0) throw Error(`Owned synthetic ${program} failed; output withheld`)
    return result.stdout
  }
  const before = await snapshot()
  const backupStarted = performance.now()
  const dump = run('pg_dump', ['-U','supabase_admin','-d','postgres','--format=custom','--data-only',
    '--table=public.*','--table=private.*','--table=auth.users','--table=auth.identities'])
  assert.ok(dump.length > 1024 && dump.length < 64 * 1024 * 1024)
  assert.equal(dump.subarray(0, 5).toString(), 'PGDMP')
  const backupMilliseconds = Math.ceil(performance.now() - backupStarted)
  // No writers or cron run in this fixture. Detect changes before destruction.
  assert.deepEqual(await snapshot(), before)
  await verifyFile()
  const recoveryStarted = performance.now()
  try {
    await removeFile()
    // CASCADE is restricted to the unique empty-start local project. Auth
    // sessions are intentionally invalidated; user/password/identity rows return.
    run('psql', ['-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',
      'TRUNCATE '+names.join(',')+' RESTART IDENTITY CASCADE'])
    const erased = (await db.query('select (select count(*)::int from public.businesses) businesses,(select count(*)::int from auth.users) users,(select count(*)::int from storage.objects) files')).rows[0]
    assert.deepEqual(erased, { businesses: 0, users: 0, files: 0 })
    // PostgreSQL's documented data restore mechanism handles FK cycles without
    // replaying application side effects. Triggers are re-enabled by pg_restore.
    run('pg_restore', ['-U','supabase_admin','-d','postgres','--data-only','--disable-triggers','--exit-on-error','--single-transaction'], dump)
    assert.deepEqual(await snapshot(), before)
    await restoreFile()
    await verifyFile()
    const unsafe = (await db.query(`select exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and t.tgenabled='D') disabled_trigger,
      exists(select 1 from private.tier_worker_config where enabled or endpoint is not null) delivery_enabled`)).rows[0]
    assert.deepEqual(unsafe, { disabled_trigger: false, delivery_enabled: false })
    return { scope: 'synthetic data and private object; schema/configuration retained', tables: before.length,
      rows: before.reduce((n,t)=>n+t.count,0), backupMilliseconds,
      restoreMilliseconds: Math.ceil(performance.now()-recoveryStarted),
      snapshotRowsAndHashesEqual: true, separateStorageBytesRestored: true,
      syntheticDataLossRows: 0, authSessionsIntentionallyRevoked: true }
  } finally {
    dump.fill(0)
  }
}
