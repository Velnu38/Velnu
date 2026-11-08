import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const owner = '10000000-0000-4000-8000-000000000001'
const migration = await readFile(new URL('../../supabase/migrations/20261108001744_private_beta_customer_access.sql', import.meta.url), 'utf8')
const originalBeta = await readFile(new URL('../../supabase/migrations/20261103213450_ten_pro_test_accounts.sql', import.meta.url), 'utf8')
async function fixture() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to authenticated,anon;
    create table private.workspace_feature_flags(name text primary key,enabled boolean);
    insert into private.workspace_feature_flags values('ten_pro_test_accounts',true);
    create table public.user_plan_preferences(user_id uuid primary key,selected_tier text);
    create table public.businesses(id uuid primary key,created_by_user_id uuid,secret text);
    alter table public.businesses enable row level security;
    create policy owner_only on public.businesses to authenticated using(created_by_user_id=auth.uid());
    grant select,insert on public.businesses to authenticated,anon;
    create table private.business_entitlements(business_id uuid primary key,plan text,valid_until timestamptz,updated_at timestamptz);
    create table private.team_invitations(email text,token_hash text,revoked_at timestamptz,accepted_at timestamptz,expires_at timestamptz);
    create table private.platform_admin_audit(actor uuid,action text,outcome text);
    create function private.platform_admin_request(text,jsonb) returns jsonb language sql as $$
      select jsonb_build_object('operator',auth.uid()='${owner}'::uuid,'mfa_required',coalesce(auth.jwt()->>'aal','aal1')<>'aal2') $$;
  `)
  await db.exec(originalBeta)
  await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@example.test',now());insert into public.businesses values(gen_random_uuid(),'${owner}','private record');`)
  await db.exec(migration)
  return db
}
async function identity(db, id, aal = 'aal1', role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id, JSON.stringify({ aal })])
  await db.exec('set role ' + role)
}

test('existing confirmed test accounts retain admission, while anonymous table reads are denied', async () => {
  const db = await fixture()
  try {
    await identity(db, owner)
    assert.equal((await db.query('select public.get_private_beta_access() as access')).rows[0].access.allowed, true)
    assert.equal((await db.query('select secret from public.businesses')).rows[0].secret, 'private record')
    await identity(db, '', 'aal1', 'anon')
    await assert.rejects(db.query('select * from public.businesses'), /permission denied/)
    await assert.rejects(db.query('select public.get_private_beta_access()'), /permission denied/)
  } finally { await db.close() }
})

test('opening customer pages does not permit uninvited registrations or forged metadata', async () => {
  const db = await fixture()
  try {
    await assert.rejects(db.query("insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'stranger@example.test',$1)", [JSON.stringify({ finviant_invite: 'a'.repeat(64), beta: true, role: 'owner' })]), /approved email or invitation/)
    assert.equal((await db.query('select count(*)::int as count from auth.users')).rows[0].count, 1)
  } finally { await db.close() }
})

test('a valid team invitation admits only its matching email and token', async () => {
  const db = await fixture()
  const token = 'b'.repeat(64)
  try {
    await db.query("insert into private.team_invitations(email,token_hash,expires_at) values('invitee@example.test',encode(sha256(convert_to($1,'UTF8')),'hex'),now()+interval '1 day')", [token])
    await assert.rejects(db.query("insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'other@example.test',$1)", [JSON.stringify({ finviant_invite: token })]), /approved email or invitation/)
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'invitee@example.test',$1)", [JSON.stringify({ finviant_invite: token })])
    assert.equal((await db.query('select count(*)::int as count from private.test_account_slots')).rows[0].count, 2)
  } finally { await db.close() }
})

test('registration approval requires platform ownership and MFA, with the ten-account cap preserved', async () => {
  const db = await fixture()
  try {
    await identity(db, owner)
    await assert.rejects(db.query("select public.manage_private_beta_registration('new@example.test',true)"), /Verify Finviant administrator/)
    await identity(db, owner, 'aal2')
    await db.query("select public.manage_private_beta_registration('new@example.test',true)")
    await db.exec('reset role')
    for (let i = 0; i < 9; i++) {
      const email = i ? `test${i}@example.test` : 'new@example.test'
      await db.query('insert into private.private_beta_registration_allowlist(email) values($1) on conflict do nothing', [email])
      await db.query('insert into auth.users(id,email) values(gen_random_uuid(),$1)', [email])
    }
    await db.query("insert into private.private_beta_registration_allowlist(email) values('eleventh@example.test')")
    await assert.rejects(db.query("insert into auth.users(id,email) values(gen_random_uuid(),'eleventh@example.test')"), /limited to 10 accounts/)
    assert.equal((await db.query('select count(*)::int as count from auth.users')).rows[0].count, 10)
  } finally { await db.close() }
})
