import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture, plan, user, B, U, O } from "./fixture";
const migration = "supabase/migrations/20261108165736_e_business_card.sql";
const card = {
  name: "ACME, Services; LLC",
  phone: "+1 757 555 0123",
  email: "hello@example.test",
  website: "https://example.test",
  tagline: "Service & repairs",
  include_address: false,
  street: "123 Private Road",
  city: "Chesapeake",
  region: "VA",
  postal_code: "23320",
};
async function setup() {
  const db = await fixture();
  await db.exec(
    "reset role;alter table private.finviant_email_outbox add column if not exists customer_snapshot jsonb;",
  );
  await db.exec(await readFile(migration, "utf8"));
  await user(db);
  return db;
}
async function state(db: any, b = B) {
  return (await db.query("select get_business_card($1) s", [b])).rows[0].s;
}
async function save(db: any, d = card, r: string | null = null) {
  return (
    await db.query("select save_business_card($1,$2,$3) s", [
      B,
      JSON.stringify(d),
      r,
    ])
  ).rows[0].s;
}
async function output(db: any, r: string) {
  return (await db.query("select export_business_card($1,$2) s", [B, r]))
    .rows[0].s;
}
test("one company card defaults to business contacts; owner edits, authorized office shares, no address by default", async () => {
  const db = await setup();
  try {
    const original = await state(db);
    assert.equal(original.card.name, "Test Company");
    assert.equal(original.card.email, "owner@example.test");
    assert.equal(original.card.include_address, false);
    assert.equal(original.revision, null);
    const saved = await save(db);
    assert.ok(saved.revision);
    const vcf = (await output(db, saved.revision)).vcard;
    assert.match(vcf, /BEGIN:VCARD\r\nVERSION:3.0/);
    assert.match(vcf, /FN:ACME\\, Services\\; LLC/);
    assert.match(vcf, /ORG:ACME/);
    assert.doesNotMatch(vcf, /ADR|Private Road/);
    const withAddress = await save(
      db,
      { ...card, include_address: true },
      saved.revision,
    );
    assert.match(
      (await output(db, withAddress.revision)).vcard,
      /ADR;TYPE=WORK:;;123 Private Road;Chesapeake;VA;23320;/,
    );
    await assert.rejects(save(db, card, saved.revision), /card changed/);
    await assert.rejects(output(db, saved.revision), /current card/);
    await user(db, O);
    assert.equal((await state(db)).can_edit, false);
    assert.match((await output(db, withAddress.revision)).vcard, /ACME/);
    await assert.rejects(
      save(db, card, withAddress.revision),
      /primary Business Pro owner/,
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query<any>("select count(*)::int n from private.tier_usage"))
        .rows[0].n,
      0,
      "Downloads do not reserve messaging usage",
    );
    await db.query(
      "update business_members set access_modules='{}' where user_id=$1",
      [O],
    );
    await user(db, O);
    await assert.rejects(state(db), /access denied/);
  } finally {
    await db.close();
  }
});
test("Free/Individual, anonymous and cross-business callers cannot export or edit; malformed fields are rejected", async () => {
  const db = await setup();
  try {
    const saved = await save(db);
    for (const tier of ["free", "basic"]) {
      await plan(db, tier);
      assert.equal((await state(db)).card, null);
      await assert.rejects(output(db, saved.revision), /Business Pro/);
      await assert.rejects(save(db), /Business Pro/);
    }
    await plan(db, "pro");
    for (const invalid of [
      { ...card, name: "" },
      { ...card, phone: "", email: "" },
      { ...card, name: "A\r\nTEL:attacker" },
      { ...card, email: "bad" },
      { ...card, website: "javascript:alert(1)" },
      { ...card, tagline: "x".repeat(301) },
    ])
      await assert.rejects(save(db, invalid, saved.revision), /Enter|Check/);
    await assert.rejects(
      state(db, "77777777-7777-4777-8777-777777777777"),
      /access denied/,
    );
    await db.exec(
      "reset role;select set_config('request.jwt.claim.sub','',false);set role authenticated",
    );
    await assert.rejects(state(db), /access denied/);
    await db.exec("reset role;set role anon");
    await assert.rejects(state(db), /permission denied/);
    await db.exec("reset role;set role authenticated");
    await assert.rejects(
      db.query("select * from private.business_cards"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("Unicode folds at 75 UTF-8 octets without splitting characters and semicolons cannot create contact fields", async () => {
  const db = await setup();
  try {
    const saved = await save(db, {
      ...card,
      name: "修理 🛠️ ".repeat(25),
      tagline: "Repairs; Emergency, service \\ available",
    });
    const text = (await output(db, saved.revision)).vcard;
    for (const line of text.split("\r\n"))
      assert.ok(Buffer.byteLength(line, "utf8") <= 75);
    const unfolded = text.replace(/\r\n /g, "");
    assert.ok(unfolded.includes("FN:" + "修理 🛠️ ".repeat(25).trim()));
    assert.match(
      unfolded,
      /NOTE:Repairs\\; Emergency\\, service \\\\ available/,
    );
    assert.equal(text.split("BEGIN:VCARD").length, 2);
  } finally {
    await db.close();
  }
});
test("card email freezes exact vCard, reserves one email once, rejects different retries and unresolved new sends", async () => {
  const db = await setup();
  try {
    const saved = await save(db);
    await db.exec("reset role");
    await db.query(
      "insert into private.managed_delivery_accounts(business_id,email_active,reply_to) values($1,true,'owner@example.test')",
      [B],
    );
    const id = crypto.randomUUID(),
      send = (
        request = id,
        recipient = "customer@example.test",
        revision = saved.revision,
      ) =>
        db.query<any>("select prepare_business_card_email($1,$2,$3,$4,$5) s", [
          U,
          B,
          request,
          recipient,
          revision,
        ]);
    await send();
    await send();
    const o = (
      await db.query<any>(
        "select * from private.finviant_email_outbox where id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(o.document_kind, "business_card");
    assert.deepEqual(o.payload.to, ["customer@example.test"]);
    assert.match(
      Buffer.from(o.payload.attachments[0].content, "base64").toString(),
      /VERSION:3.0/,
    );
    assert.equal(
      (
        await db.query<any>(
          "select used from private.tier_usage where business_id=$1 and feature='email'",
          [B],
        )
      ).rows[0].used,
      1,
    );
    await assert.rejects(send(id, "changed@example.test"), /different details/);
    await assert.rejects(send(crypto.randomUUID()), /earlier card email/);
    await db.query(
      "update private.finviant_email_outbox set status='accepted' where id=$1",
      [id],
    );
    await db.query(
      "update private.tier_usage set used=2000 where business_id=$1 and feature='email'",
      [B],
    );
    await assert.rejects(send(crypto.randomUUID()), /allowance reached/);
    await user(db, O);
    await assert.rejects(send(crypto.randomUUID()), /permission denied/);
    await user(db);
    assert.equal((await state(db)).pending_send, null);
  } finally {
    await db.close();
  }
});

test("private beta card email accepts approved recipients only and rolls back rejected queue and usage", async () => {
  const db = await setup();
  try {
    await save(db);
    await db.exec(
      "reset role;alter table auth.users add column email text,add column email_confirmed_at timestamptz;",
    );
    await db.query(
      "update auth.users set email='owner@example.test',email_confirmed_at=now() where id=$1",
      [U],
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261107225351_private_beta_email_delivery.sql",
        "utf8",
      ),
    );
    await db.exec(
      "insert into private.workspace_feature_flags(name,enabled) values('ten_pro_test_accounts',true) on conflict(name) do update set enabled=true;update private.workspace_feature_flags set enabled=true where name='private_beta_email_delivery'",
    );
    await db.query("select private.enroll_private_beta_email($1)", [B]);
    await user(db);
    const saved = await state(db);
    await db.exec("reset role");
    const send = (recipient: string) =>
      db.query("select prepare_business_card_email($1,$2,$3,$4,$5)", [
        U,
        B,
        crypto.randomUUID(),
        recipient,
        saved.revision,
      ]);
    await assert.rejects(
      send("unapproved@example.test"),
      /BETA_EMAIL_RECIPIENT_NOT_APPROVED/,
    );
    assert.equal(
      (
        await db.query<any>(
          "select count(*)::int n from private.finviant_email_outbox",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query<any>("select count(*)::int n from public.messages"))
        .rows[0].n,
      0,
    );
    await send("delivered@resend.dev");
    assert.equal(
      (
        await db.query<any>(
          "select used from private.tier_usage where business_id=$1 and feature='email'",
          [B],
        )
      ).rows[0].used,
      1,
    );
  } finally {
    await db.close();
  }
});
