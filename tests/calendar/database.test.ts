import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const b = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  u = "33333333-3333-4333-8333-333333333333",
  e = "44444444-4444-4444-8444-444444444444",
  i = "55555555-5555-4555-8555-555555555555",
  j = "66666666-6666-4666-8666-666666666666";
const migration = await readFile(
  new URL(
    "../../supabase/migrations/20261102144435_calendar_sync_dashboard.sql",
    import.meta.url,
  ),
  "utf8",
);
const fixture = await readFile(
  new URL("./fixture.sql", import.meta.url),
  "utf8",
);
async function setup() {
  const db = new PGlite();
  await db.exec(fixture);
  await db.exec(migration);
  await db.exec(
    `insert into auth.users values('${u}');insert into businesses values('${b}','America/New_York'),('${other}','America/Los_Angeles');insert into business_members values('${b}','${u}','owner');insert into estimates(id,business_id,status) values('${e}','${b}','sent');`,
  );
  return db;
}
async function schedule(db: PGlite, status = "scheduled") {
  await db.query(
    `insert into document_schedules(business_id,estimate_id,job_title,scheduled_start_time,scheduled_end_time,timezone,status) values($1,$2,'Repair','2026-11-02T15:00Z','2026-11-02T16:00Z','America/New_York',$3)`,
    [b, e, status],
  );
}
async function count(db: PGlite, table: string) {
  return Number(
    (await db.query<{ n: string }>(`select count(*) n from ${table}`)).rows[0]
      .n,
  );
}
test("schema applies; planned estimate waits for approval; conversion preserves one event and invoice deep link", async () => {
  const db = await setup();
  try {
    await schedule(db, "planned");
    assert.equal(await count(db, "calendar_work"), 0);
    await db.query("update estimates set status='accepted' where id=$1", [e]);
    assert.equal(await count(db, "calendar_work"), 1);
    const before = (
      await db.query<{ source_key: string }>(
        "select source_key from calendar_work",
      )
    ).rows[0].source_key;
    await db.query(
      "insert into invoices(id,business_id,estimate_id,status) values($1,$2,$3,'draft')",
      [i, b, e],
    );
    await db.query("update estimates set status='converted' where id=$1", [e]);
    const after = (
      await db.query<{
        source_key: string;
        document_id: string;
        document_kind: string;
      }>("select * from calendar_work")
    ).rows[0];
    assert.equal(after.source_key, before);
    assert.equal(after.document_id, i);
    assert.equal(after.document_kind, "invoice");
    await db.query("update invoices set status='paid' where id=$1", [i]);
    assert.equal(await count(db, "calendar_work"), 1);
    await db.query("update invoices set status='void' where id=$1", [i]);
    assert.equal(await count(db, "calendar_work"), 0);
  } finally {
    await db.close();
  }
});
test("RLS and foreign keys prevent cross-business schedule reads and writes; credentials are inaccessible", async () => {
  const db = await setup();
  try {
    await schedule(db);
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${u}',false);`,
    );
    assert.equal(await count(db, "document_schedules"), 1);
    await assert.rejects(
      () =>
        db.query(
          `insert into document_schedules(business_id,estimate_id,job_title,scheduled_start_time,scheduled_end_time,timezone) values($1,$2,'Intrusion',now(),now()+interval '1 hour','UTC')`,
          [other, e],
        ),
      /row-level security/,
    );
    await assert.rejects(
      () => db.query("select * from private.calendar_integrations"),
      /permission denied/,
    );
    await db.exec(
      "select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',false)",
    );
    assert.equal(await count(db, "document_schedules"), 0);
    assert.equal(await count(db, "calendar_work"), 0);
    await db.exec("reset role");
    await assert.rejects(
      () => db.query("update document_schedules set business_id=$1", [other]),
      /identity cannot change/,
    );
  } finally {
    await db.close();
  }
});
test("queue is atomic with status changes, coalesces updates and rolls back with failed transaction", async () => {
  const db = await setup();
  try {
    await db.query(
      "insert into private.calendar_integrations(business_id,user_id,provider,account_id,email) values($1,$2,'google','a','test@example.test')",
      [b, u],
    );
    await schedule(db);
    assert.equal(await count(db, "private.calendar_sync_queue"), 1);
    await db.exec("begin;update estimates set status='accepted';rollback;");
    assert.equal(
      (
        await db.query<{ revision: number }>(
          "select revision from private.calendar_sync_queue",
        )
      ).rows[0].revision,
      1,
    );
    await db.exec(
      "update estimates set status='accepted';update estimates set status='declined';",
    );
    assert.equal(await count(db, "private.calendar_sync_queue"), 1);
    assert.equal(
      (
        await db.query<{ revision: number }>(
          "select revision from private.calendar_sync_queue",
        )
      ).rows[0].revision,
      3,
    );
    await db.query("delete from business_members where business_id=$1", [b]);
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from private.calendar_integrations",
        )
      ).rows[0].state,
      "disconnecting",
    );
  } finally {
    await db.close();
  }
});
test("appointments suppress job duplicates; cancelled appointments do not resurrect a scheduled job", async () => {
  const db = await setup();
  try {
    await db.query(
      "insert into jobs values($1,$2,null,'Job','2026-11-02T15:00Z','2026-11-02T16:00Z','scheduled')",
      [j, b],
    );
    assert.equal(await count(db, "calendar_work"), 1);
    await db.query(
      "insert into appointments values($1,$2,$3,'Visit','2026-11-02T15:00Z','2026-11-02T16:00Z','scheduled',null)",
      [i, b, j],
    );
    assert.equal(await count(db, "calendar_work"), 1);
    assert.match(
      (
        await db.query<{ source_key: string }>(
          "select source_key from calendar_work",
        )
      ).rows[0].source_key,
      /appointment:/,
    );
    await db.exec("update appointments set status='canceled'");
    assert.equal(await count(db, "calendar_work"), 0);
  } finally {
    await db.close();
  }
});
test("date integrity rejects reversed intervals, invalid zones, and scheduling documents linked to jobs", async () => {
  const db = await setup();
  try {
    await schedule(db);
    await assert.rejects(
      () =>
        db.exec(
          "update document_schedules set scheduled_end_time=scheduled_start_time",
        ),
      /check constraint/,
    );
    await assert.rejects(
      () => db.exec("update document_schedules set timezone='Bad/Zone'"),
      /Invalid IANA/,
    );
    await db.query("update estimates set job_id=$1 where id=$2", [j, e]);
    await assert.rejects(
      () => db.exec("update document_schedules set job_title='Other'"),
      /linked jobs/,
    );
  } finally {
    await db.close();
  }
});
