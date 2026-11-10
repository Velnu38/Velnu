import test from "node:test";
import assert from "node:assert/strict";
import { executionFixture, ids, actor } from "./execution-fixture.ts";
const businessDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const J = "88888888-8888-4888-8888-888888888888",
  V1 = "99999999-9999-4999-8999-999999999991",
  V2 = "99999999-9999-4999-8999-999999999992";
const run = async (db: any, name: string, args: unknown[]) =>
  (
    await db.query(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as value`,
      args,
    )
  ).rows[0].value;
async function job(db: any) {
  await db.exec(
    `reset role;insert into jobs(id,business_id,customer_id,property_id,title) values('${J}','${ids.business}','${ids.customer}','${ids.site}','Repair');set role authenticated`,
  );
}
async function visit(db: any, id: string, day: number, worker = ids.worker) {
  return run(db, "manage_job_visit", [
    ids.business,
    J,
    "save",
    {
      id,
      version: 0,
      title: "Visit " + day,
      starts_at: `2027-01-${day}T14:00:00Z`,
      ends_at: `2027-01-${day}T16:00:00Z`,
      workers: [worker],
    },
  ]);
}
test("multiple future visits have separate crews; reschedules change exactly one appointment and conflicts/early completion fail", async () => {
  const db = await executionFixture();
  try {
    await job(db);
    await visit(db, V1, 11);
    await visit(db, V2, 12, ids.owner);
    await visit(db, V1, 11);
    const d = await run(db, "get_job_management", [ids.business, J]);
    assert.equal(d.visits.length, 2);
    assert.equal(d.visits[0].worker_ids[0], ids.worker);
    assert.equal(
      (
        await db.query(`select scheduled_start::text from jobs where id=$1`, [
          J,
        ])
      ).rows[0].scheduled_start.slice(0, 10),
      "2027-01-11",
    );
    await assert.rejects(
      db.query(`update jobs set status='completed' where id=$1`, [J]),
    );
    await run(db, "save_job_appointment", [
      J,
      "2027-01-11T17:00:00Z",
      "2027-01-11T18:00:00Z",
      "2027-01-11T14:00:00Z",
      "2027-01-11T16:00:00Z",
      false,
    ]);
    const d2 = await run(db, "get_job_management", [ids.business, J]);
    assert.equal(d2.visits[1].starts_at.slice(0, 10), "2027-01-12");
    await assert.rejects(
      run(db, "manage_job_visit", [
        ids.business,
        J,
        "save",
        {
          id: crypto.randomUUID(),
          version: 0,
          title: "Conflict",
          starts_at: "2027-01-12T15:00:00Z",
          ends_at: "2027-01-12T16:00:00Z",
          workers: [ids.owner],
        },
      ]),
      /already has a visit/,
    );
  } finally {
    await db.close();
  }
});

test("restricted field account sees assigned work only, can submit progress/time, and loses access after reassignment or downgrade", async () => {
  const db = await executionFixture();
  try {
    await job(db);
    await db.exec(
      `reset role;insert into jobs(id,business_id,customer_id,title) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${ids.business}','${ids.customer}','Office only');set role authenticated`,
    );
    await run(db, "manage_job_visit", [
      ids.business,
      J,
      "save",
      {
        id: V1,
        version: 0,
        title: "Current work",
        starts_at: new Date(Date.now() - 3600000).toISOString(),
        ends_at: new Date(Date.now() + 3600000).toISOString(),
        workers: [ids.worker],
      },
    ]);
    await visit(db, V2, 12, ids.owner);
    const taskId = crypto.randomUUID();
    await run(db, "manage_job_workspace", [
      ids.business,
      J,
      "add_task",
      {
        id: taskId,
        title: "Test fitting",
        worker_id: ids.worker,
        visit_id: V1,
      },
    ]);
    await run(db, "set_field_account", [
      ids.business,
      ids.worker,
      ids.worker,
      0,
    ]);
    await actor(db, ids.worker);
    const context = await run(db, "get_field_access_context", [ids.business]);
    assert.equal(context.restricted, true);
    assert.equal(context.active, true);
    assert.equal((await db.query("select id from jobs")).rows.length, 0);
    assert.equal((await db.query("select id from customers")).rows.length, 0);
    await assert.rejects(
      run(db, "get_job_workspace", [ids.business, J]),
      /access required/,
    );
    await assert.rejects(
      run(db, "get_job_management", [ids.business, J]),
      /access required/,
    );
    await assert.rejects(
      run(db, "get_field_jobs", [
        ids.business,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ]),
      /not assigned/,
    );
    const field = await run(db, "get_field_jobs", [ids.business, J]);
    assert.equal(field[0].visits.length, 1);
    assert.equal(JSON.stringify(field).includes("hourly_cost"), false);
    await run(db, "manage_field_job", [
      ids.business,
      J,
      "task",
      { id: taskId, version: 1, completed: true },
    ]);
    await run(db, "manage_field_job", [
      ids.business,
      J,
      "start_visit",
      { id: V1, version: 1 },
    ]);
    const started = await run(db, "get_field_jobs", [ids.business, J]);
    const v = started[0].visits[0];
    await run(db, "manage_field_job", [
      ids.business,
      J,
      "finish_visit",
      { id: V1, version: v.version },
    ]);
    const rid = crypto.randomUUID(),
      input = {
        id: rid,
        worked_on: businessDate(),
        minutes: 90,
        note: "Fitting tested",
        visit_id: V1,
      };
    await run(db, "manage_field_job", [ids.business, J, "time", input]);
    await run(db, "manage_field_job", [ids.business, J, "time", input]);
    await assert.rejects(
      run(db, "manage_field_job", [
        ids.business,
        J,
        "time",
        { ...input, minutes: 120 },
      ]),
      /different time/,
    );
    await assert.rejects(
      run(db, "manage_field_job", [
        ids.business,
        J,
        "time",
        { ...input, id: crypto.randomUUID(), worked_on: "2027-02-01" },
      ]),
      /today or earlier/,
    );
    await actor(db, ids.owner);
    const review = await run(db, "get_job_cost_review", [ids.business, J]);
    assert.equal(review.pending_time.length, 1);
    await run(db, "manage_job_cost_review", [
      ids.business,
      J,
      "approve_time",
      { id: rid, version: 1, hourly_cost: 40 },
    ]);
    await run(db, "manage_job_cost_review", [
      ids.business,
      J,
      "approve_time",
      { id: rid, version: 1, hourly_cost: 40 },
    ]);
    const w = await run(db, "get_job_workspace", [ids.business, J]);
    assert.equal(w.time.length, 1);
    assert.equal(
      (Number(w.time[0].minutes) * Number(w.time[0].hourly_cost)) / 60,
      60,
    );
    await actor(db, ids.worker);
    const after = await run(db, "get_field_jobs", [ids.business, J]);
    assert.equal(after[0].time[0].status, "posted");
    assert.equal(JSON.stringify(after).includes("hourly_cost"), false);
    await db.exec(
      `reset role;update appointments set visit_worker_ids=array['${ids.owner}'::uuid],assigned_user_id='${ids.owner}' where id='${V1}';update jobs set assigned_user_ids=array['${ids.owner}'::uuid] where id='${J}';set role authenticated`,
    );
    await assert.rejects(
      run(db, "get_field_jobs", [ids.business, J]),
      /not assigned/,
    );
    await db.exec(
      `reset role;update private.business_entitlements set plan='basic' where business_id='${ids.business}';set role authenticated`,
    );
    assert.equal(
      (await run(db, "get_field_access_context", [ids.business])).restricted,
      true,
    );
    await assert.rejects(
      run(db, "get_field_jobs", [ids.business, null]),
      /paused/,
    );
  } finally {
    await db.close();
  }
});

test("cost review uses one allocation, supports audited duplicate exclusion and rate correction, denies field/tenant writes", async () => {
  const db = await executionFixture();
  try {
    await job(db);
    const eid = crypto.randomUUID();
    await db.exec(
      `reset role;insert into bookkeeping_entries(id,business_id,entry_date,direction,amount,currency,category,description,job_id) values('${eid}','${ids.business}',current_date,'expense',60,'USD','labor','Labor already tracked','${J}');set role authenticated`,
    );
    await run(db, "manage_job_workspace", [
      ids.business,
      J,
      "add_time",
      {
        request_id: crypto.randomUUID(),
        worked_on: businessDate(),
        minutes: 90,
        hourly_cost: 0,
        worker_id: ids.worker,
      },
    ]);
    let w = await run(db, "get_job_workspace", [ids.business, J]);
    assert.equal(Number(w.recorded_expenses), 60);
    await run(db, "manage_job_cost_review", [
      ids.business,
      J,
      "exclude_expense",
      { id: eid, reason: "Payment is already included in time cost" },
    ]);
    w = await run(db, "get_job_workspace", [ids.business, J]);
    assert.equal(Number(w.recorded_expenses), 0);
    await run(db, "manage_job_cost_review", [
      ids.business,
      J,
      "rate",
      { id: w.time[0].id, version: 1, hourly_cost: 40 },
    ]);
    await assert.rejects(
      run(db, "manage_job_cost_review", [
        ids.business,
        J,
        "rate",
        { id: w.time[0].id, version: 1, hourly_cost: 50 },
      ]),
      /rate changed/,
    );
    await run(db, "manage_job_cost_review", [
      ids.business,
      J,
      "include_expense",
      { id: eid },
    ]);
    assert.equal(
      Number(
        (await run(db, "get_job_workspace", [ids.business, J]))
          .recorded_expenses,
      ),
      60,
    );
    await actor(db, ids.outsider);
    await assert.rejects(
      run(db, "get_job_cost_review", [ids.business, J]),
      /Financial and job access/,
    );
    await assert.rejects(
      run(db, "manage_job_cost_review", [
        ids.business,
        J,
        "rate",
        { id: w.time[0].id, version: 2, hourly_cost: 10 },
      ]),
      /Financial and job access/,
    );
  } finally {
    await db.close();
  }
});

test("completion reports are numbered immutable snapshots, replay-safe and keep selected photos private and retained", async () => {
  const db = await executionFixture();
  try {
    await job(db);
    const rid = crypto.randomUUID(),
      photo = crypto.randomUUID(),
      path = ids.business + "/" + photo + ".jpg",
      input = {
        summary: "Repaired and tested equipment.",
        photos: [photo],
        customer_present: true,
        signer: "Test Customer",
        consent: "I acknowledge the work described in this completion report.",
      };
    await assert.rejects(
      run(db, "create_job_report", [ids.business, J, rid, input]),
      /Complete the job/,
    );
    await db.exec(
      `reset role;insert into record_photos(id,business_id,job_id,file_name,byte_size,media_type,created_by) values('${photo}','${ids.business}','${J}','After work.jpg',12,'image/jpeg','${ids.owner}');insert into storage.objects(bucket_id,name,metadata) values('finviant-record-photos','${path}','{"size":12}');update jobs set status='completed',completed_at=now() where id='${J}';set role authenticated`,
    );
    const r = await run(db, "create_job_report", [ids.business, J, rid, input]);
    assert.equal(r.version, 1);
    assert.equal(r.snapshot.signoff.method, "Typed in person");
    assert.equal(r.snapshot.photos.length, 1);
    assert.deepEqual(
      await run(db, "create_job_report", [ids.business, J, rid, input]),
      r,
    );
    await assert.rejects(
      run(db, "create_job_report", [
        ids.business,
        J,
        rid,
        { ...input, summary: "Different" },
      ]),
      /different content/,
    );
    await assert.rejects(
      db.query("delete from record_photos where id=$1", [photo]),
      /retained/,
    );
    assert.equal(
      (
        await db.query(
          "delete from storage.objects where name=$1 returning name",
          [path],
        )
      ).rows.length,
      0,
    );
    const second = await run(db, "create_job_report", [
      ids.business,
      J,
      crypto.randomUUID(),
      {
        ...input,
        summary: "Updated work description",
        customer_present: false,
        signer: "",
        consent: "",
      },
    ]);
    assert.equal(second.version, 2);
    const all = await run(db, "get_job_reports", [ids.business, J]);
    assert.equal(all[1].snapshot.summary, input.summary);
    assert.equal(all[0].snapshot.signoff, null);
    await actor(db, ids.outsider);
    await assert.rejects(
      run(db, "get_job_reports", [ids.business, J]),
      /Job access/,
    );
  } finally {
    await db.close();
  }
});

test("three-visit approved job, deposit, approved addition, tracked costs, completion and invoice retry preserve one final balance", async () => {
  const db = await executionFixture(true);
  try {
    await db.exec(`reset role;`);
    const quote = crypto.randomUUID();
    await db.query(
      "insert into estimates(id,business_id,customer_id) values($1,$2,$3)",
      [quote, ids.business, ids.customer],
    );
    await db.query(
      "insert into estimate_items(estimate_id,business_id,description,quantity,unit_price,tax_rate) values($1,$2,'Repair',2,50,5)",
      [quote, ids.business],
    );
    await db.query("update estimates set status='accepted' where id=$1", [
      quote,
    ]);
    const deposit = await run(db, "create_estimate_deposit", [quote, 30]);
    await db.query("update invoices set status='sent' where id=$1", [deposit]);
    await run(db, "record_manual_payment", [
      ids.business,
      deposit,
      crypto.randomUUID(),
      30,
      "cash",
      "Synthetic receipt",
    ]);
    await db.query(
      "insert into jobs(id,business_id,customer_id,property_id,title,status,source_estimate_id) values($1,$2,$3,$4,'Repair','in_progress',$5)",
      [J, ids.business, ids.customer, ids.site, quote],
    );
    await db.query("update estimates set job_id=$1 where id=$2", [J, quote]);
    const change = crypto.randomUUID();
    await db.query(
      "insert into change_orders(id,business_id,customer_id,estimate_id,job_id,title) values($1,$2,$3,$4,$5,'Approved addition')",
      [change, ids.business, ids.customer, quote, J],
    );
    await db.query(
      "insert into change_order_items(change_order_id,business_id,description,quantity,unit_price,tax_rate) values($1,$2,'Extra work',1,20,0)",
      [change, ids.business],
    );
    await db.query("update change_orders set status='approved' where id=$1", [
      change,
    ]);
    await db.exec("set role authenticated");
    const visits = [V1, V2, crypto.randomUUID()];
    for (let k = 0; k < visits.length; k++) {
      const start = new Date(Date.now() - (5 - k) * 86400000);
      await run(db, "manage_job_visit", [
        ids.business,
        J,
        "save",
        {
          id: visits[k],
          version: 0,
          title: "Stage " + (k + 1),
          starts_at: start.toISOString(),
          ends_at: new Date(+start + 3600000).toISOString(),
          workers: [k === 1 ? ids.owner : ids.worker],
        },
      ]);
    }
    await db.exec("reset role");
    await assert.rejects(
      run(db, "complete_job_workflow", [J, ids.owner, false]),
      /remaining visits/,
    );
    await db.exec("set role authenticated");
    for (const id of visits)
      await run(db, "manage_job_visit", [
        ids.business,
        J,
        "finish",
        { id, version: 1 },
      ]);
    await run(db, "manage_job_workspace", [
      ids.business,
      J,
      "add_time",
      {
        request_id: crypto.randomUUID(),
        worked_on: businessDate(),
        minutes: 120,
        hourly_cost: 25,
        worker_id: ids.worker,
      },
    ]);
    await db.exec(
      `reset role;insert into bookkeeping_entries(business_id,job_id,entry_date,direction,amount,currency) values('${ids.business}','${J}',current_date,'expense',15,'USD')`,
    );
    const result = await run(db, "complete_job_workflow", [
      J,
      ids.owner,
      false,
    ]);
    assert.equal(result.invoice_ready, true);
    const final = (
      await db.query(
        "select total,deposit_credit,balance_due from invoices where id=$1",
        [result.invoice_id],
      )
    ).rows[0];
    assert.equal(Number(final.total), 95);
    assert.equal(Number(final.deposit_credit), 30);
    assert.equal(Number(final.balance_due), 95);
    assert.equal(
      (await run(db, "complete_job_workflow", [J, ids.owner, true])).invoice_id,
      result.invoice_id,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from invoices where estimate_id=$1",
          [quote],
        )
      ).rows[0].n,
      1,
    );
    const workspace = await run(db, "get_job_workspace", [ids.business, J]);
    assert.equal(Number(workspace.recorded_expenses), 15);
    assert.equal(
      (Number(workspace.time[0].minutes) *
        Number(workspace.time[0].hourly_cost)) /
        60,
      50,
    );
    const report = await run(db, "create_job_report", [
      ids.business,
      J,
      crypto.randomUUID(),
      {
        summary: "Three stages completed and tested.",
        photos: [],
        customer_present: false,
      },
    ]);
    assert.equal(
      report.snapshot.visits.filter((v: any) => v.status === "completed")
        .length,
      3,
    );
  } finally {
    await db.close();
  }
});

test("future crew conflicts, stale visit edits and same-time legacy repair are enforced across calendar views", async () => {
  const db = await executionFixture();
  try {
    await job(db);
    await visit(db, V1, 11, ids.owner);
    await visit(db, V2, 12, ids.worker);
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await db.exec(
      `reset role;insert into jobs(id,business_id,customer_id,title) values('${other}','${ids.business}','${ids.customer}','Other work');set role authenticated`,
    );
    await assert.rejects(
      run(db, "manage_job_visit", [
        ids.business,
        other,
        "save",
        {
          id: crypto.randomUUID(),
          version: 0,
          title: "Conflicting crew",
          starts_at: "2027-01-12T15:00:00Z",
          ends_at: "2027-01-12T16:00:00Z",
          workers: [ids.worker],
        },
      ]),
      /crew is unavailable/,
    );
    await assert.rejects(
      run(db, "manage_job_visit", [
        ids.business,
        J,
        "save",
        {
          id: V2,
          version: 0,
          title: "Stale edit",
          starts_at: "2027-01-13T14:00:00Z",
          ends_at: "2027-01-13T16:00:00Z",
          workers: [ids.worker],
        },
      ]),
      /visit changed/,
    );
    const calendar = (
      await db.query(
        `select source_key,assigned_user_ids from calendar_work where job_id=$1 order by starts_at`,
        [J],
      )
    ).rows;
    assert.equal(calendar.length, 2);
    assert.deepEqual(calendar[1].assigned_user_ids, [ids.worker]);
    // Legacy repair must create an absent appointment, including an initially unassigned job.
    await db.exec(
      `reset role;update jobs set scheduled_start='2027-01-14T14:00:00Z',scheduled_end='2027-01-14T16:00:00Z' where id='${other}';set role authenticated`,
    );
    await run(db, "save_job_appointment", [
      other,
      "2027-01-14T14:00:00Z",
      "2027-01-14T16:00:00Z",
      "2027-01-14T14:00:00Z",
      "2027-01-14T16:00:00Z",
      false,
    ]);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from appointments where job_id=$1",
          [other],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("Calendar closes one visit of a multi-visit job and preserves the remaining schedule and job", async () => {
  const db = await executionFixture();
  try {
    await job(db);
    const past = new Date(Date.now() - 3600000);
    await run(db, "manage_job_visit", [
      ids.business,
      J,
      "save",
      {
        id: V1,
        version: 0,
        title: "Current stage",
        starts_at: past.toISOString(),
        ends_at: new Date(+past + 1800000).toISOString(),
        workers: [ids.owner],
      },
    ]);
    await visit(db, V2, 12);
    const result = await run(db, "update_appointment_workflow", [
      V1,
      "completed",
    ]);
    assert.equal(result.visit_only, true);
    let d = await run(db, "get_job_management", [ids.business, J]);
    assert.equal(d.visits.find((v: any) => v.id === V1).status, "completed");
    assert.equal(d.visits.find((v: any) => v.id === V2).status, "confirmed");
    assert.equal(
      (await db.query("select status from jobs where id=$1", [J])).rows[0]
        .status,
      "in_progress",
    );
    const retry = await run(db, "update_appointment_workflow", [
      V1,
      "completed",
    ]);
    assert.equal(retry.visit_only, true);
    await run(db, "update_appointment_workflow", [V2, "canceled"]);
    assert.equal(
      (await db.query("select status from jobs where id=$1", [J])).rows[0]
        .status,
      "in_progress",
    );
  } finally {
    await db.close();
  }
});

test("assigned photo metadata and storage reservation enforce assignment, ownership, revocation and anonymous denial", async () => {
  const db = await executionFixture();
  try {
    await job(db);
    await visit(db, V1, 11);
    await run(db, "set_field_account", [
      ids.business,
      ids.worker,
      ids.worker,
      0,
    ]);
    await actor(db, ids.worker);
    const photo = crypto.randomUUID(),
      path = await run(db, "prepare_field_photo", [
        ids.business,
        J,
        photo,
        "Work photo.jpg",
        100,
      ]);
    assert.equal(path, ids.business + "/" + photo + ".jpg");
    assert.equal(
      (await db.query("select count(*)::int n from record_photos")).rows[0].n,
      1,
    );
    await db.exec("reset role;set role service_role");
    await run(db, "reserve_attachment", [
      ids.worker,
      "finviant-record-photos",
      path,
      100,
    ]);
    await db.exec("reset role;set role authenticated");
    await actor(db, ids.owner);
    await run(db, "set_field_account", [ids.business, ids.worker, null, 1]);
    await actor(db, ids.worker);
    await assert.rejects(
      run(db, "get_field_jobs", [ids.business, null]),
      /paused/,
    );
    assert.equal(
      (await db.query("select count(*)::int n from record_photos")).rows[0].n,
      0,
    );
    assert.equal(
      (await run(db, "get_field_access_context", [ids.business])).restricted,
      true,
    );
    await assert.rejects(
      run(db, "clear_field_account", [ids.business, ids.worker, 2]),
      /Primary owner/,
    );
    await actor(db, ids.owner);
    await run(db, "clear_field_account", [ids.business, ids.worker, 2]);
    await actor(db, ids.worker);
    assert.equal(
      (await run(db, "get_field_access_context", [ids.business])).restricted,
      false,
    );
    await db.exec("reset role");
    const privileges = (
      await db.query(
        `select bool_and(not has_function_privilege('anon',oid,'execute')) ok from pg_proc where pronamespace='public'::regnamespace and proname in('get_field_jobs','clear_field_account','manage_field_job','prepare_field_photo','manage_job_visit','get_job_reports','create_job_report','get_job_cost_review','manage_job_cost_review','set_field_account')`,
      )
    ).rows[0];
    assert.equal(privileges.ok, true);
  } finally {
    await db.close();
  }
});

