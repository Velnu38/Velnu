import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { runSyncBatch } from "../../server/calendar/worker.js";
import { CalendarError } from "../../server/calendar/errors.js";
import type { Pool, PoolClient } from "pg";
import type { CalendarService } from "../../server/calendar/types.js";
const b = "11111111-1111-4111-8111-111111111111",
  u = "33333333-3333-4333-8333-333333333333",
  j = "66666666-6666-4666-8666-666666666666",
  id = "77777777-7777-4777-8777-777777777777";
const fixture = await readFile(
    new URL("./fixture.sql", import.meta.url),
    "utf8",
  ),
  migration = await readFile(
    new URL(
      "../../supabase/migrations/20261102144435_calendar_sync_dashboard.sql",
      import.meta.url,
    ),
    "utf8",
  );
async function setup() {
  const db = new PGlite();
  await db.exec(fixture);
  await db.exec(migration);
  await db.exec(
    `insert into auth.users values('${u}');insert into businesses values('${b}','America/New_York');insert into business_members values('${b}','${u}','owner');insert into private.calendar_integrations(id,business_id,user_id,provider,account_id,email,auto_sync) values('${id}','${b}','${u}','google','a','test@example.test',true);insert into jobs values('${j}','${b}',null,'Work','2026-11-02T15:00Z','2026-11-02T16:00Z','scheduled');`,
  );
  return db;
}
function runtime(db: PGlite, svc: CalendarService) {
  const adapter = {
    query: (sql: string, values?: unknown[]) => db.query(sql, values),
  };
  return {
    database: () => adapter as unknown as Pool,
    transaction: async <T>(fn: (db: PoolClient) => Promise<T>) =>
      db.transaction((tx) =>
        fn({
          query: (sql: string, values?: unknown[]) => tx.query(sql, values),
        } as unknown as PoolClient),
      ),
    provider: () => svc as never,
    appOrigin: () => "https://finviant.example",
  };
}
test('crew calendar sync includes secondary workers, removes reassigned work, and uses the job link for field staff',async()=>{
 const db=await setup();try{
 const source=await readFile('supabase/migrations/20261102212737_guided_scheduling_workflow.sql','utf8')
 const from=source.indexOf('create or replace view public.calendar_work'),to=source.indexOf('-- Recheck an invitation',from)
 await db.exec('alter table public.jobs add column assigned_user_ids uuid[] default \'{}\';')
 await db.exec(source.slice(from,to))
 const lead='99999999-9999-4999-8999-999999999999'
 await db.query('update jobs set assigned_user_ids=$1 where id=$2',[[lead,u],j])
 await db.query("insert into appointments(id,business_id,job_id,title,starts_at,ends_at,status,assigned_user_id) values('88888888-8888-4888-8888-888888888888',$1,$2,'Work','2026-11-02T15:00Z','2026-11-02T16:00Z','scheduled',$3)",[b,j,lead])
 await db.exec("update business_members set role='technician'")
 const events:any[]=[];let deletes=0
 const svc:CalendarService={calendars:async()=>[],upsert:async(_id,_remote,event)=>{events.push(event);return 'remote-crew-event'},remove:async()=>{deletes++}}
 await runSyncBatch(runtime(db,svc))
 assert.equal(events.length,1);assert.match(events[0].description,new RegExp('view=work&document='+j))
 await db.query('update jobs set assigned_user_ids=$1 where id=$2',[[lead],j])
 await runSyncBatch(runtime(db,svc));assert.equal(deletes,1);assert.equal(events.length,1)
 }finally{await db.close()}
})
test("worker reconciles once, skips duplicates, reschedules, cancels and disconnects", async () => {
  const db = await setup();
  try {
    let creates = 0,
      deletes = 0;
    const svc: CalendarService = {
      calendars: async () => [],
      upsert: async () => {
        creates++;
        return "remote-id";
      },
      remove: async () => {
        deletes++;
      },
    };
    const rt = runtime(db, svc);
    await runSyncBatch(rt);
    assert.equal(creates, 1);
    await db.exec("update jobs set title=title");
    await runSyncBatch(rt);
    assert.equal(creates, 1);
    await db.exec(
      "update jobs set scheduled_start=scheduled_start+interval '1 hour',scheduled_end=scheduled_end+interval '1 hour'",
    );
    await runSyncBatch(rt);
    assert.equal(creates, 2);
    await db.exec("update jobs set status='canceled'");
    await runSyncBatch(rt);
    assert.equal(deletes, 1);
    await db.exec(
      "update private.calendar_integrations set state='disconnecting';update jobs set title=title",
    );
    await runSyncBatch(rt);
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from private.calendar_integrations",
        )
      ).rows[0].state,
      "disconnected",
    );
  } finally {
    await db.close();
  }
});
test("rate limits retry later; revoked authorization stops retry storm", async () => {
  const db = await setup();
  try {
    let reason = "rate";
    const svc: CalendarService = {
      calendars: async () => [],
      upsert: async () => {
        throw reason === "rate"
          ? new CalendarError("provider_rate_limited", true, 120, 429)
          : new CalendarError("authorization_revoked", false, 0, 401);
      },
      remove: async () => {},
    };
    await runSyncBatch(runtime(db, svc));
    let row = (
      await db.query<{ dead: boolean; attempts: number; delay: number }>(
        "select dead,attempts,extract(epoch from available_at-now()) delay from private.calendar_sync_queue",
      )
    ).rows[0];
    assert.equal(row.dead, false);
    assert.equal(row.attempts, 1);
    assert(Number(row.delay) > 110);
    reason = "revoked";
    await db.exec("update private.calendar_sync_queue set available_at=now()");
    await runSyncBatch(runtime(db, svc));
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from private.calendar_integrations",
        )
      ).rows[0].state,
      "reconnect_required",
    );
    assert.equal(
      (
        await db.query<{ dead: boolean }>(
          "select dead from private.calendar_sync_queue",
        )
      ).rows[0].dead,
      true,
    );
  } finally {
    await db.close();
  }
});
test("removed membership causes remote cleanup; incomplete schedules remove stale events", async () => {
  const db = await setup();
  try {
    let deletes = 0;
    const svc: CalendarService = {
      calendars: async () => [],
      upsert: async () => "remote-id",
      remove: async () => {
        deletes++;
      },
    };
    await runSyncBatch(runtime(db, svc));
    await db.exec("update jobs set scheduled_end=null");
    await runSyncBatch(runtime(db, svc));
    assert.equal(deletes, 1);
    assert.equal(
      (
        await db.query<{ last_error: string }>(
          "select last_error from private.calendar_integrations",
        )
      ).rows[0].last_error,
      "schedule_requires_end_time",
    );
    await db.exec(
      "update jobs set scheduled_end=scheduled_start+interval '1 hour'",
    );
    await runSyncBatch(runtime(db, svc));
    await db.exec("delete from business_members");
    await runSyncBatch(runtime(db, svc));
    assert.equal(deletes, 2);
  } finally {
    await db.close();
  }
});
