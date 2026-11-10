import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'
import { verifyReminderReplay } from './reminder-replay.mjs'
import { verifyAuthStorageReplay } from './auth-storage-replay.mjs'
import { verifySyntheticRestore, cleanupSyntheticFixture } from './synthetic-restore.mjs'

export const CLI_VERSION = '3.1.0'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export function localDatabaseUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('Expected a local PostgreSQL URL')
  if (url.hostname !== '127.0.0.1' || url.port !== '54322' || url.pathname !== '/postgres'
      || url.username !== 'postgres' || url.search || url.hash) {
    throw new Error('Replay only accepts the owned local Supabase database on 127.0.0.1:54322')
  }
  return url.href
}

export function migrationManifest(directory) {
  const files = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
  const versions = new Set()
  return files.map(name => {
    const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(name)
    if (!match || versions.has(match[1])) throw new Error('Invalid or duplicate migration version')
    versions.add(match[1])
    const sql = readFileSync(join(directory, name), 'utf8')
    return { file: name, version: match[1], name: match[2], sha256: createHash('sha256').update(sql).digest('hex'), sql }
  })
}

// Do not echo SQL, row values, status output, or connection strings into public CI.
export function safeDatabaseError(error) {
  const result = { code: /^[0-9A-Z]{5}$/.test(error.code ?? '') ? error.code : 'unknown' }
  for (const key of ['schema', 'table', 'column', 'constraint']) {
    if (/^[a-zA-Z_][a-zA-Z0-9_]{0,100}$/.test(error[key] ?? '')) result[key] = error[key]
  }
  const message = error.message ?? ''
  if (/^(?:relation|function|type|schema|extension|role|column) [a-zA-Z0-9_"., ()\[\]]+ (?:does not exist|already exists|is not available)$/.test(message)) result.message = message
  return result
}

export async function requireEmptyPlatform(client) {
  const { rows: [state] } = await client.query(`select
    to_regclass('auth.users') is not null as auth,
    to_regclass('storage.objects') is not null as storage,
    to_regclass('public.businesses') is null as empty_application,
    not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m')) as empty_public`)
  if (!state.auth || !state.storage || !state.empty_application || !state.empty_public) throw new Error('Replay requires a fresh Supabase platform with managed Auth and Storage schemas')
  const { rows: [counts] } = await client.query(`select (select count(*) from auth.users)::int as users, (select count(*) from storage.objects)::int as objects`)
  if (counts.users || counts.objects) throw new Error('Replay refuses a database with existing identities or files')
}

export async function replay(client, manifest) {
  await requireEmptyPlatform(client)
  const { rows: [cron] } = await client.query('show cron.launch_active_jobs')
  if (cron['cron.launch_active_jobs'] !== 'off') throw new Error('Replay requires local cron execution to be disabled before migrations')
  const applied = []
  for (const migration of manifest) {
    try {
      // Each file is submitted unchanged. No fixture extraction or missing-object shims.
      await client.query(migration.sql)
      applied.push({ file: migration.file, sha256: migration.sha256 })
      console.log(`Applied ${migration.file}`)
    } catch (error) {
      console.error(JSON.stringify({ migration: migration.file, applied: applied.length, error: safeDatabaseError(error) }))
      throw new Error(`Full migration replay failed at ${migration.version}`)
    }
  }
  const { rows: [safety] } = await client.query(`select
    not exists(select 1 from private.tier_worker_config where enabled or endpoint is not null) as delivery_disabled,
    not exists(select 1 from vault.secrets) as empty_vault,
    not exists(select 1 from auth.users) as no_identities,
    not exists(select 1 from storage.objects) as no_files`)
  if (!Object.values(safety).every(value => value === true)) throw new Error('Fresh replay unexpectedly enabled delivery or created identities/files')
  const { rows: extensions } = await client.query('select extname,extversion from pg_extension order by extname')
  const { rows: [version] } = await client.query('select version() as postgres')
  return { applied, extensions, postgres: version.postgres, safety }
}

function cleanCliEnvironment() {
  // No hosted project refs, provider credentials, or Supabase environment overrides.
  const names = ['PATH', 'HOME', 'TMPDIR', 'CI', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR']
  return Object.fromEntries(names.filter(name => process.env[name]).map(name => [name, process.env[name]]))
}

export async function main({capacity=false}={}) {
  if (process.argv.length > 2) throw new Error('Replay accepts no database URL, project ref, or command-line arguments')
  const directory = mkdtempSync(join(tmpdir(), 'finviant-replay-'))
  const projectId = `finviant-replay-${randomUUID().slice(0, 8)}`
  const env = { ...cleanCliEnvironment(), SUPABASE_HOME: join(directory, 'runtime') }
  const cli = (args, timeout = 120_000) => {
    const result = spawnSync('npm', ['exec', '--yes', `--package=supabase@${CLI_VERSION}`, '--', 'supabase', ...args, '--workdir', directory], {
      cwd: directory, env, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024,
    })
    if (result.status !== 0) throw new Error(`Local Supabase ${args[0]} failed (${result.error?.code ?? result.status ?? 'unknown'}); captured output withheld because it can contain local keys`)
    return result.stdout
  }
  let started = false
  let client
  try {
    cli(['init', '--yes'])
    const configPath = join(directory, 'supabase/config.toml')
    const config = readFileSync(configPath, 'utf8')
      .replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`)
      .replace(/major_version\s*=\s*\d+/, 'major_version = 17')
    // All 300 synthetic clients share localhost; this is not an Auth throttle test.
    const ownedConfig=capacity?config.replace(/^sign_in_sign_ups\s*=.*$/m,'sign_in_sign_ups = 10000').replace(/^token_refresh\s*=.*$/m,'token_refresh = 10000'):config
    writeFileSync(configPath, ownedConfig)
    console.log(`Starting disposable Supabase with CLI ${CLI_VERSION}; no hosted credentials or source migrations at startup`)
    started = true
    cli(['start', '--exclude', 'realtime,imgproxy,studio,postgres-meta,edge-runtime,logflare,vector,supavisor'], 720_000)
    const status = JSON.parse(cli(['status', '-o', 'json']))
    if (!status.DB_URL) throw new Error('Local Supabase status did not return a database URL')
    client = new pg.Client({ connectionString: localDatabaseUrl(status.DB_URL), application_name: 'finviant-disposable-replay', connectionTimeoutMillis: 10_000, statement_timeout: 30_000 })
    await client.connect()
    await requireEmptyPlatform(client)
    // The managed postgres role cannot ALTER SYSTEM. Use only our uniquely named
    // disposable container's local administrator, never a hosted administrator.
    const configure = spawnSync('docker', ['exec', `supabase_db_${projectId}`, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
      '-c', "alter system set cron.launch_active_jobs = 'off'", '-c', 'select pg_reload_conf()'], {
      encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    })
    if (configure.status !== 0) throw new Error('Could not disable cron in the owned disposable container')
    const manifest = migrationManifest(join(root, 'supabase/migrations'))
    const result = await replay(client, manifest)
    const smokeSql = readFileSync(join(root, 'tests/migrations/release-smoke.sql'), 'utf8')
    try {
      await client.query(smokeSql)
    } catch (error) {
      console.error(JSON.stringify({ phase: 'fresh-schema-financial-tenant-smoke', error: safeDatabaseError(error) }))
      throw new Error('Fresh-schema financial/tenant smoke failed')
    }
    const reminderSmoke = await verifyReminderReplay(client, localDatabaseUrl(status.DB_URL))
    const authStorageSmoke = await verifyAuthStorageReplay(client, status,
      options => verifySyntheticRestore(client, { projectId, ...options }),
      options => cleanupSyntheticFixture(client, { projectId, ...options }))
    const { rows: [cleanup] } = await client.query(`select
      (select count(*) from auth.users)::int as users,
      (select count(*) from public.businesses)::int as businesses,
      (select count(*) from public.payments)::int as payments,
      (select count(*) from storage.objects)::int as files`)
    if (Object.values(cleanup).some(value => value !== 0)) throw new Error('Synthetic replay smoke did not roll back completely')
    const capacityResult=capacity?await (await import('./local-capacity.mjs')).verifyLocalCapacity(client,status,{projectId}):undefined
    console.log(JSON.stringify({ result: 'passed', cli: CLI_VERSION,
      cronLaunchActiveJobs: false, reminderSmoke, authStorageSmoke, capacity:capacityResult,
      smoke: { file: 'tests/migrations/release-smoke.sql', sha256: createHash('sha256').update(smokeSql).digest('hex'), passed: true, rolledBackCounts: cleanup },
      migrations: result.applied.length, ...result }, null, 2))
  } finally {
    if (client) await client.end()
    // Unique project only. Never use --all, a linked ref, or a remote db reset.
    if (started) cli(['stop', '--project-id', projectId, '--no-backup'])
    rmSync(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
