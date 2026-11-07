import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const migration = await readFile(
  "supabase/migrations/20261102170333_owner_team_document_settings.sql",
  "utf8",
);
const baseline = await readFile(
  "supabase/migrations/20261028173902_finviant_complete_application_bootstrap.sql",
  "utf8",
);
const owner = "11111111-1111-4111-8111-111111111111",
  employee = "22222222-2222-4222-8222-222222222222",
  business = "33333333-3333-4333-8333-333333333333",
  outsider = "44444444-4444-4444-8444-444444444444";
const uid = (n: number) =>
  `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`;
function baseFunction(name: string) {
  const start = baseline.indexOf("CREATE OR REPLACE FUNCTION " + name + "(");
  return baseline.slice(start, baseline.indexOf("$function$;", start) + 12);
}
async function setup() {
  const db = new PGlite();
  await db.exec(`
 set check_function_bodies=false;
 create role authenticated;create role anon;create role service_role;create schema auth;create schema private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create table businesses(id uuid primary key,name text,created_by_user_id uuid);
 create table business_members(business_id uuid references businesses,user_id uuid references auth.users,role text,created_at timestamptz default now(),primary key(business_id,user_id));
 create table business_settings(business_id uuid primary key references businesses,payment_links jsonb not null default '[]',payment_instructions text not null default '');
 create table private.business_entitlements(business_id uuid primary key,plan text);
 create function private.is_pro(b uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from private.business_entitlements where business_id=b and plan='pro')$$;
 create function private.velnu_has_accepted_terms() returns boolean language sql stable as $$select coalesce(current_setting('test.terms',true),'true')='true'$$;
 create table document_approvals(business_id uuid);create table voice_transcriptions(business_id uuid);create table business_branding(business_id uuid);
 create table ai_actions(id uuid,business_id uuid,user_id uuid);
 create table private.finviant_ai_attempt_budget(business_id uuid);
 create table private.finviant_email_outbox(id uuid,business_id uuid,actor_id uuid,document_kind text,document_id uuid,payload jsonb,status text,last_code text,created_at timestamptz,attempts int,lease uuid);
 create table record_photos(id uuid primary key default gen_random_uuid(),business_id uuid,job_id uuid,invoice_id uuid,estimate_id uuid);
 create table bookkeeping_entries(id uuid primary key default gen_random_uuid(),business_id uuid,job_id uuid,invoice_id uuid,estimate_id uuid,amount numeric);
 create table invoices(id uuid primary key default gen_random_uuid(),business_id uuid,payment_links jsonb default '[]',payment_instructions text default '',total numeric);
 create table estimates(id uuid primary key default gen_random_uuid(),business_id uuid,total numeric);
 create table jobs(id uuid primary key default gen_random_uuid(),business_id uuid,title text);
 grant usage on schema private,public,auth to authenticated;
 grant select,insert,update,delete on all tables in schema public to authenticated;
 `);
  for (const table of [
    "businesses",
    "business_members",
    "business_settings",
    "ai_actions",
    "record_photos",
    "bookkeeping_entries",
    "invoices",
    "estimates",
    "jobs",
  ]) {
    await db.exec(
      `alter table ${table} enable row level security;create policy tenant on ${table} to authenticated using(true) with check(true);`,
    );
  }
  await db.exec(baseFunction("private.commerce_auxiliary_limit"));
  await db.exec(
    "create trigger commerce_auxiliary_limit before insert or update on business_members for each row execute function private.commerce_auxiliary_limit()",
  );
  await db.exec(migration);
  await db.exec(
    await readFile(
      "supabase/migrations/20261102173504_private_team_preview.sql",
      "utf8",
    ),
  );
  await db.exec(`insert into auth.users values('${owner}','owner@example.test',now()),('${employee}','employee@example.test',now()),('${outsider}','outsider@example.test',now());
 insert into businesses values('${business}','QA Company','${owner}');insert into private.business_entitlements values('${business}','pro');
 insert into business_members(business_id,user_id,role) values('${business}','${owner}','owner'),('${business}','${employee}','admin');
 insert into invoices(business_id,total) values('${business}',100);insert into jobs(business_id,title) values('${business}','Job');
 set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`);
  return db;
}
const actor = (db: PGlite, id: string) =>
  db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
async function invite(
  db: PGlite,
  n: number,
  email = `invite${n}@example.test`,
) {
  return (
    await db.query<{ result: any }>(
      `select reserve_team_invitation($1,$2,'office',array['billing'], $3) result`,
      [business, email, String(n).padStart(64, "a")],
    )
  ).rows[0].result;
}
test("owner alone manages members; admin and outsider fail; primary owner cannot be removed", async () => {
  const db = await setup();
  try {
    await actor(db, employee);
    await assert.rejects(
      () => db.query("select get_team_settings($1)", [business]),
      /primary owner/,
    );
    await assert.rejects(() => invite(db, 1), /primary owner/);
    await assert.rejects(
      () =>
        db.query("update business_members set role='owner' where user_id=$1", [
          employee,
        ]),
      /permission denied/,
    );
    await actor(db, outsider);
    await assert.rejects(() => invite(db, 2), /primary owner/);
    await actor(db, owner);
    await assert.rejects(
      () =>
        db.query("select manage_team_member($1,$2,'remove')", [
          business,
          owner,
        ]),
      /owner cannot be changed/,
    );
    await db.query(
      "select manage_team_member($1,$2,'update','office',array['jobs'])",
      [business, employee],
    );
    await actor(db, employee);
    assert.equal((await db.query("select * from invoices")).rows.length, 0);
    assert.equal((await db.query("select * from jobs")).rows.length, 1);
    await assert.rejects(
      () =>
        db.query("insert into invoices(business_id) values($1)", [business]),
      /row-level security/,
    );
    await assert.rejects(
      () =>
        db.query("insert into business_settings(business_id) values($1)", [
          business,
        ]),
      /row-level security/,
    );
    await actor(db, owner);
    await db.query("select manage_team_member($1,$2,'remove')", [
      business,
      employee,
    ]);
    await actor(db, employee);
    assert.equal((await db.query("select * from jobs")).rows.length, 0);
  } finally {
    await db.close();
  }
});
test("five seats include pending invitations, cancellation/expiry release seats and acceptance binds verified email", async () => {
  const db = await setup();
  try {
    await invite(db, 1);
    const second = await invite(db, 2);
    await invite(db, 3);
    await assert.rejects(() => invite(db, 4), /All 5/);
    await db.query("select manage_team_member($1,$2,'revoke')", [
      business,
      second.id,
    ]);
    await invite(db, 4);
    await actor(db, outsider);
    await assert.rejects(
      () =>
        db.query("select accept_team_invitation($1)", [
          String(1).padStart(64, "a"),
        ]),
      /verified email/,
    );
    await db.exec(
      `reset role;insert into auth.users values('${uid(1)}','invite1@example.test',now());set role authenticated;`,
    );
    await actor(db, uid(1));
    assert.equal(
      (
        await db.query<{ id: string }>("select accept_team_invitation($1) id", [
          String(1).padStart(64, "a"),
        ])
      ).rows[0].id,
      business,
    );
    assert.equal((await db.query("select * from invoices")).rows.length, 1);
    assert.equal((await db.query("select * from jobs")).rows.length, 0);
    await db.query("select accept_team_invitation($1)", [
      String(1).padStart(64, "a"),
    ]); // safe retry
    await actor(db, owner);
    await db.exec(
      `reset role;update private.team_invitations set expires_at=now()-interval '1 day' where email='invite4@example.test';set role authenticated;`,
    );
    await invite(db, 5);
    await actor(db, outsider);
    await assert.rejects(
      () =>
        db.query("select accept_team_invitation($1)", [
          String(2).padStart(64, "a"),
        ]),
      /verified email|expired/,
    );
  } finally {
    await db.close();
  }
});
test("payment destinations are owner-only, links validated, and no paid subscription is invented", async () => {
  const db = await setup();
  try {
    await db.exec("reset role");
    await db.exec(baseFunction("private.valid_payment_links"));
    await db.exec("set role authenticated");
    const good = [
      { provider: "paypal", url: "https://paypal.me/business" },
      { provider: "cashapp", url: "https://cash.app/$Company" },
    ];
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "select private.valid_payment_links($1) ok",
          [JSON.stringify(good)],
        )
      ).rows[0].ok,
      true,
    );
    for (const url of [
      "javascript:alert(1)",
      "https://www.paypal.com.evil.test/pay",
      "https://www.paypal.com@evil.test/pay",
      "https://paypal.me/test%0d",
    ])
      assert.equal(
        (
          await db.query<{ ok: boolean }>(
            "select private.valid_payment_links($1) ok",
            [JSON.stringify([{ provider: "paypal", url }])],
          )
        ).rows[0].ok,
        false,
      );
    assert.equal(
      (
        await db.query<{ binding: unknown }>(
          "select get_billing_binding($1) binding",
          [business],
        )
      ).rows[0].binding,
      null,
    );
    await actor(db, employee);
    await assert.rejects(
      () => db.query("select get_billing_binding($1)", [business]),
      /primary owner/,
    );
    await assert.rejects(
      () =>
        db.query("update invoices set payment_links=$1 where business_id=$2", [
          JSON.stringify(good),
          business,
        ]),
      /primary owner/,
    );
  } finally {
    await db.close();
  }
});

test("private team preview enables five seats without granting paid Pro or allowing owner flag changes", async () => {
  const db = await setup();
  try {
    await db.exec(
      "reset role;update private.business_entitlements set plan='free';set role authenticated;",
    );
    await assert.rejects(() => invite(db, 1), /active Pro/);
    await assert.rejects(
      () => db.query("update private.workspace_feature_flags set enabled=true"),
      /permission denied/,
    );
    await db.exec(
      "reset role;update private.workspace_feature_flags set enabled=true where name='team_private_preview';set role authenticated;",
    );
    const state = (
      await db.query<{ s: any }>("select get_team_settings($1) s", [business])
    ).rows[0].s;
    assert.equal(state.seat_limit, 5);
    assert.equal(state.pro, false);
    assert.equal(state.private_preview, true);
    await invite(db, 1);
  } finally {
    await db.close();
  }
});


test("audit: preserve existing administrator while editing modules; deny promotion and nonowner changes",async()=>{
 const db=await setup();try{
  await db.exec('reset role');
  await db.exec(await readFile('supabase/migrations/20261103182409_audit_flow_recovery.sql','utf8'));
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`);
  await db.query("select manage_team_member($1,$2,'update','admin',array['calendar','jobs'])",[business,employee]);
  assert.equal((await db.query<{role:string}>('select role from business_members where user_id=$1',[employee])).rows[0].role,'admin');
  await db.query("select manage_team_member($1,$2,'update','office',array['calendar','jobs'])",[business,employee]);
  await assert.rejects(()=>db.query("select manage_team_member($1,$2,'update','admin',array['calendar'])",[business,employee]),/Invalid team permissions/);
  await db.exec(`select set_config('request.jwt.claim.sub','${employee}',false)`);
  await assert.rejects(()=>db.query("select manage_team_member($1,$2,'update','office',array['calendar'])",[business,outsider]),/Only the primary owner/);
 }finally{await db.close()}
});
