import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../../supabase/migrations/20261107213625_calendar_service_setup.sql', import.meta.url), 'utf8');
const verification = await readFile(new URL('../../supabase/patches/verify-calendar-service-setup.sql', import.meta.url), 'utf8');

async function setup() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./fixture.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../supabase/migrations/20261102144435_calendar_sync_dashboard.sql', import.meta.url), 'utf8'));
  await db.exec(`
    alter table public.jobs add column assigned_user_ids uuid[];
    create schema extensions;
    create schema vault;
    create table vault.decrypted_secrets(name text primary key,decrypted_secret text);
    create type extensions.http_header as (field varchar,value varchar);
    create type extensions.http_request as (method text,uri varchar,headers extensions.http_header[],content_type varchar,content varchar);
    create type extensions.http_response as (status integer,content_type varchar,headers extensions.http_header[],content varchar);
    create table private.test_http_options(name text primary key,value text);
    create table private.test_http_calls(request extensions.http_request,options jsonb);
    create table private.test_http_state(status integer,content text,reject_option text,transport_error boolean default false);
    insert into private.test_http_state values(200,'{"processed":1}',null,false);
    create function extensions.http_header(varchar,varchar) returns extensions.http_header language sql as $$select row($1,$2)::extensions.http_header$$;
    create function extensions.http_reset_curlopt() returns boolean language plpgsql as $$begin delete from private.test_http_options;return true;end$$;
    create function extensions.http_set_curlopt(varchar,varchar) returns boolean language plpgsql as $$begin
      if exists(select 1 from private.test_http_state where reject_option=$1) then return false;end if;
      insert into private.test_http_options values($1,$2) on conflict(name) do update set value=excluded.value;return true;
    end$$;
    create function extensions.http(extensions.http_request) returns extensions.http_response language plpgsql as $$declare s private.test_http_state;begin
      if exists(select 1 from private.test_http_state where transport_error) then raise exception 'unsafe transport detail fake-worker-secret';end if;
      insert into private.test_http_calls select $1,(select jsonb_object_agg(name,value) from private.test_http_options);
      select * into s from private.test_http_state;
      return row(s.status,'application/json',array[]::extensions.http_header[],s.content)::extensions.http_response;
    end$$;
  `);
  // PGlite has no libcurl extension. Exercise actual SQL with a deliberately
  // non-network transport fixture; real extension/TLS verification is separate.
  await db.exec(migration.replace('create extension if not exists http with schema extensions;', '-- transport fixture installed above'));
  return db;
}

async function provisionSyntheticSecrets(db: PGlite) {
  await db.exec(`insert into vault.decrypted_secrets values
    ('finviant_calendar_worker_secret','fake-worker-secret'),
    ('finviant_vercel_protection_bypass','fake-bypass-secret');`);
}

test('calendar setup starts with NOLOGIN, narrowly grants dependencies, and passes rollback-only verification', async () => {
  const db = await setup();
  try {
    const role = (await db.query<{ rolcanlogin: boolean; rolbypassrls: boolean }>("select rolcanlogin,rolbypassrls from pg_roles where rolname='calendar_worker'")).rows[0];
    assert.deepEqual(role, { rolcanlogin: false, rolbypassrls: true });
    const before = (await db.query("select member,grantor,admin_option,inherit_option,set_option from pg_auth_members where roleid='calendar_worker'::regrole order by member,grantor")).rows;
    await db.exec(verification);
    const after = (await db.query("select member,grantor,admin_option,inherit_option,set_option from pg_auth_members where roleid='calendar_worker'::regrole order by member,grantor")).rows;
    assert.deepEqual(after, before, 'verification must not persist membership changes');
    assert.equal((await db.query<{ n: number }>('select count(*)::integer n from private.test_http_calls')).rows[0].n, 0);
    for (const role of ['anon', 'authenticated', 'service_role', 'calendar_worker']) {
      const access = (await db.query<{ allowed: boolean }>("select has_function_privilege($1,'private.run_calendar_worker()','EXECUTE') as allowed", [role])).rows[0];
      assert.equal(access.allowed, false, role);
    }
  } finally { await db.close(); }
});

test('owner-only scheduler requires both secrets before transport and blocks runtime access', async () => {
  const db = await setup();
  try {
    await assert.rejects(db.query('select private.run_calendar_worker()'), /calendar_scheduler_setup_required/);
    await db.exec('set role calendar_worker');
    await assert.rejects(db.query('select private.run_calendar_worker()'), /permission denied/);
    await assert.rejects(db.query('select * from vault.decrypted_secrets'), /permission denied/);
    await db.exec('reset role');
    assert.equal((await db.query<{ n: number }>('select count(*)::integer n from private.test_http_calls')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('scheduler uses fixed HTTPS destination, verified TLS, bounded time, and returns only batch count', async () => {
  const db = await setup();
  try {
    await provisionSyntheticSecrets(db);
    await db.exec(`update private.test_http_state set content='{"processed":1,"unexpected":"fake secret response"}'`);
    const result = (await db.query<{ result: unknown }>('select private.run_calendar_worker() as result')).rows[0].result;
    assert.deepEqual(result, { processed: 1 });
    const call = (await db.query<{ uri: string; method: string; headers: { field: string; value: string }[]; options: Record<string,string> }>(`
      select (request).uri,(request).method,
        (select jsonb_agg(jsonb_build_object('field',(h).field,'value',(h).value)) from unnest((request).headers) h) as headers,
        options from private.test_http_calls
    `)).rows[0];
    assert.equal(call.uri, 'https://finviant.com/api/calendar-worker');
    assert.equal(call.method, 'GET');
    assert.deepEqual(call.headers, [
      { field: 'Authorization', value: 'Bearer fake-worker-secret' },
      { field: 'x-vercel-protection-bypass', value: 'fake-bypass-secret' },
    ]);
    assert.deepEqual(call.options, {
      CURLOPT_TIMEOUT_MS: '60000', CURLOPT_CONNECTTIMEOUT: '10',
      CURLOPT_SSL_VERIFYPEER: '1', CURLOPT_SSL_VERIFYHOST: '2',
    });
    assert.equal((await db.query<{ n: number }>('select count(*)::integer n from private.test_http_options')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('scheduler refuses malformed headers, unsafe transport settings, and unsanitized responses', async () => {
  const db = await setup();
  try {
    await provisionSyntheticSecrets(db);
    await db.exec("update vault.decrypted_secrets set decrypted_secret=E'fake\\r\\nInjected: value' where name='finviant_calendar_worker_secret'");
    await assert.rejects(db.query('select private.run_calendar_worker()'), /calendar_scheduler_setup_required/);
    await db.exec("update vault.decrypted_secrets set decrypted_secret='fake-worker-secret' where name='finviant_calendar_worker_secret';update private.test_http_state set reject_option='CURLOPT_SSL_VERIFYPEER'");
    await assert.rejects(db.query('select private.run_calendar_worker()'), /calendar_scheduler_transport_failed/);
    await db.exec('update private.test_http_state set reject_option=null,transport_error=true');
    await assert.rejects(db.query('select private.run_calendar_worker()'), error => {
      assert.equal((error as Error).message, 'calendar_scheduler_transport_failed');
      return true;
    });
    await db.exec('update private.test_http_state set transport_error=false,status=401');
    await assert.rejects(db.query('select private.run_calendar_worker()'), /calendar_scheduler_http_401/);
    await db.exec("update private.test_http_state set status=200,content='not JSON fake secret'");
    await assert.rejects(db.query('select private.run_calendar_worker()'), /calendar_scheduler_invalid_response/);
  } finally { await db.close(); }
});
