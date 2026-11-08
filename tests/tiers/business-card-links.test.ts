import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture, user, plan, invoice, B, U, O, C, I } from "./fixture";
const T = "a".repeat(64),
  T2 = "b".repeat(64);
const card = {
  name: "Acme Services",
  phone: "7575550123",
  email: "hello@example.test",
  website: "https://example.test",
  tagline: "Repairs & service",
  include_address: false,
  street: "Private Street",
  city: "City",
  region: "VA",
  postal_code: "12345",
};
async function setup() {
  const db = await fixture();
  await db.exec("reset role");
  await db.exec(
    await readFile(
      "supabase/migrations/20261108165736_e_business_card.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261108172645_business_card_links.sql",
      "utf8",
    ),
  );
  await user(db);
  const r = (
    await db.query<any>("select save_business_card($1,$2,null) v", [
      B,
      JSON.stringify(card),
    ])
  ).rows[0].v.revision;
  return { db, r };
}
const val = async (db: any, q: string, args: any[] = []) =>
  (await db.query(q, args)).rows[0].v;
const publish = (db: any, r: string, t = T) =>
  val(db, "select publish_business_card($1,$2,$3) v", [B, r, t]);
const read = (db: any, t = T) =>
  val(db, "select get_shared_business_card($1) v", [t]);
test("public card is an unlisted immutable snapshot; address and internal identifiers are omitted; revoke and expiry fail closed", async () => {
  const { db, r } = await setup();
  try {
    const link = await publish(db, r);
    assert.match(link.url, /finviant.com\/\?business_card=/);
    await db.exec(
      "reset role;select set_config('request.jwt.claim.sub','',false);set role anon",
    );
    const shared = await read(db);
    assert.equal(shared.card.name, card.name);
    assert.equal(shared.card.street, undefined);
    assert.equal(shared.business_id, undefined);
    assert.doesNotMatch(shared.vcard, /Private Street|ADR/);
    assert.equal(await read(db, T2), null);
    assert.equal(await read(db, "bad"), null);
    await assert.rejects(
      db.query("select * from private.business_card_links"),
      /permission denied/,
    );
    await user(db);
    const next = (
      await val(db, "select save_business_card($1,$2,$3) v", [
        B,
        JSON.stringify({ ...card, name: "Updated", include_address: true }),
        r,
      ])
    ).revision;
    assert.equal((await read(db)).card.name, card.name);
    await publish(db, next, T2);
    assert.match((await read(db, T2)).vcard, /Private Street/);
    await db.query("select revoke_business_card_link($1,$2)", [B, T]);
    assert.equal(await read(db), null);
    await db.exec("reset role");
    await db.query(
      "update private.business_card_links set expires_at=now()-interval '1 second' where revision=$1",
      [next],
    );
    assert.equal(await read(db, T2), null);
  } finally {
    await db.close();
  }
});
test("only Pro authorized office users publish; only owner revokes; cross-tenant/stale revisions and mismatched token retries fail", async () => {
  const { db, r } = await setup();
  try {
    await plan(db, "basic");
    await assert.rejects(publish(db, r), /Business Pro/);
    await plan(db, "free");
    await assert.rejects(publish(db, r), /Business Pro/);
    await plan(db, "pro");
    await user(db, O);
    await publish(db, r);
    await assert.rejects(
      db.query("select revoke_business_card_link($1,$2)", [B, T]),
      /primary owner/,
    );
    await assert.rejects(publish(db, crypto.randomUUID()), /changed/);
    await user(db);
    await assert.rejects(publish(db, r), /changed/);
    await assert.rejects(
      val(db, "select publish_business_card($1,$2,$3) v", [
        crypto.randomUUID(),
        r,
        T2,
      ]),
      /access/,
    );
  } finally {
    await db.close();
  }
});
test("email freezes the exact link/attachment, links customer history, reserves quota once and rejects changed customer or link on replay", async () => {
  const { db, r } = await setup();
  try {
    await publish(db, r);
    await invoice(db);
    await db.query(
      "insert into private.managed_delivery_accounts(business_id,email_active,reply_to) values($1,true,'owner@example.test')",
      [B],
    );
    const id = crypto.randomUUID();
    const send = (customer = C, t = T) =>
      val(
        db,
        "select prepare_business_card_delivery($1,$2,$3,$4,$5,$6,$7,$8,false) v",
        [U, B, id, r, t, "email", "jordan@example.test", customer],
      );
    await send();
    await send();
    const o = (
      await db.query<any>(
        "select payload from private.finviant_email_outbox where id=$1",
        [id],
      )
    ).rows[0];
    assert.ok(o.payload.text.includes(T));
    assert.match(
      Buffer.from(o.payload.attachments[0].content, "base64").toString(),
      /FN:Acme/,
    );
    assert.equal(
      (
        await db.query<any>("select customer_id from messages where id=$1", [
          id,
        ])
      ).rows[0].customer_id,
      C,
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
    await assert.rejects(send(crypto.randomUUID()), /Customer unavailable/);
    await user(db);
    const pending = await val(db, "select get_business_card_pending($1) v", [
      B,
    ]);
    assert.equal(pending.token, T);
    assert.equal(pending.customer_id, C);
  } finally {
    await db.close();
  }
});
test("SMS requires consent, active sender and non-opted-out recipient; frozen sends count segments once and uncertain attempts never reclaim", async () => {
  const { db, r } = await setup();
  try {
    await publish(db, r);
    await db.exec("reset role");
    const id = crypto.randomUUID(),
      send = (consent = true) =>
        val(
          db,
          "select prepare_business_card_delivery($1,$2,$3,$4,$5,$6,$7,null,$8) v",
          [U, B, id, r, T, "sms", "+17575550123", consent],
        );
    await assert.rejects(send(false), /permission/);
    await assert.rejects(send(), /activation/);
    await db.query(
      "insert into private.managed_delivery_accounts(business_id,sms_active,sms_from,sms_reply_route) values($1,true,'+17575550111','+17575550110')",
      [B],
    );
    await send();
    const again = await send();
    assert.equal(again.segments, 2);
    const first = await val(db, "select claim_business_card_sms($1) v", [id]);
    assert.equal(first.status, "claimed");
    assert.equal(
      (await val(db, "select claim_business_card_sms($1) v", [id])).status,
      "sending",
    );
    await db.query("select finish_managed_sms($1,'uncertain',null)", [id]);
    assert.equal(
      (await val(db, "select claim_business_card_sms($1) v", [id])).status,
      "uncertain",
    );
    const sid = "SM" + "a".repeat(32);
    await db.query("select finish_managed_sms($1,'delivered',$2)", [id, sid]);
    await db.query("select finish_managed_sms($1,'accepted',$2)", [id, sid]);
    assert.equal(
      (await db.query<any>("select status from messages where id=$1", [id]))
        .rows[0].status,
      "delivered",
    );
    assert.equal(
      (
        await db.query<any>(
          "select used from private.tier_usage where business_id=$1 and feature='sms'",
          [B],
        )
      ).rows[0].used,
      2,
    );
  } finally {
    await db.close();
  }
});

test("claim blocks opted-out recipients or revoked card access before Twilio is contacted", async () => {
  const { db, r } = await setup();
  try {
    await publish(db, r);
    await db.exec("reset role");
    await db.query(
      "insert into private.managed_delivery_accounts(business_id,sms_active,sms_from,sms_reply_route) values($1,true,'+17575550111','+17575550110')",
      [B],
    );
    const id = crypto.randomUUID();
    await db.query(
      "select prepare_business_card_delivery($1,$2,$3,$4,$5,'sms','+17575550123',null,true)",
      [U, B, id, r, T],
    );
    await db.query(
      "insert into private.sms_opt_outs(phone) values('+17575550123')",
    );
    assert.equal(
      (await val(db, "select claim_business_card_sms($1) v", [id])).status,
      "blocked",
    );
    assert.equal(
      (
        await db.query<any>(
          "select provider_id from private.business_card_sms where id=$1",
          [id],
        )
      ).rows[0].provider_id,
      null,
    );
  } finally {
    await db.close();
  }
});

test("existing invoice SMS still reconciles through the shared signed-callback RPC after card support is added", async () => {
  const { db } = await setup();
  try {
    await invoice(db);
    await user(db);
    const t = "c".repeat(64),
      id = crypto.randomUUID();
    await db.query("select prepare_personal_document($1,'invoice',$2,$3)", [
      B,
      I,
      t,
    ]);
    await db.query("select record_sms_permission($1,'+17575550123',true)", [B]);
    await db.exec("reset role");
    await db.query(
      "insert into private.managed_delivery_accounts(business_id,sms_active,sms_from,sms_reply_route) values($1,true,'+17575550111','Finviant inbox')",
      [B],
    );
    await db.query(
      "select prepare_managed_sms($1,$2,'invoice',$3,$4,$5,'+17575550123')",
      [U, B, I, id, t],
    );
    await db.query("select claim_managed_sms($1)", [id]);
    await db.query("select finish_managed_sms($1,'delivered',$2)", [
      id,
      "SM" + "f".repeat(32),
    ]);
    assert.equal(
      (await db.query<any>("select status from messages where id=$1", [id]))
        .rows[0].status,
      "delivered",
    );
    assert.equal(
      (await db.query<any>("select status from invoices where id=$1", [I]))
        .rows[0].status,
      "sent",
    );
  } finally {
    await db.close();
  }
});
