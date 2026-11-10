import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

// Called only after the owned, credential-free local replay has completed.
// Uses final application functions, real separate connections and no providers.
export async function verifyReminderReplay(db, localUrl) {
  const url = new URL(localUrl)
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.port, '54322')
  assert.equal(url.pathname, '/postgres')
  assert.equal(url.search, '')
  const counts = (await db.query('select (select count(*) from auth.users)::int users, (select count(*) from public.businesses)::int businesses')).rows[0]
  assert.deepEqual(counts, { users: 0, businesses: 0 })
  const owner = randomUUID(), outsider = randomUUID(), business = randomUUID(), customer = randomUUID(), appointment = randomUUID()
  const peers = Array.from({ length: 3 }, () => new pg.Client({ connectionString: localUrl, statement_timeout: 15000, connectionTimeoutMillis: 5000 }))
  const [claimant, blocker, editor] = peers
  try {
    await Promise.all(peers.map(c => c.connect()))
    await db.query('begin')
    await db.query(`insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
      ($1,'authenticated','authenticated','reminder-owner@example.test',now(),now(),now()),
      ($2,'authenticated','authenticated','reminder-outsider@example.test',now(),now(),now())`, [owner, outsider])
    await db.query(`insert into public.user_agreement_acceptances(user_id,agreement_version,terms_accepted,ai_disclosure_acknowledged,electronic_records_consent)
      values($1,'2026-11-06-v5',true,true,true)`, [owner])
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner])
    await db.query("insert into public.businesses(id,name,created_by_user_id,timezone) values($1,'Reminder replay',$2,'America/New_York')", [business, owner])
    await db.query("insert into private.business_entitlements(business_id,plan) values($1,'pro') on conflict(business_id) do update set plan='pro',valid_until=null", [business])
    await db.query("insert into public.customers(id,business_id,first_name,last_name,email,preferred_contact) values($1,$2,'Synthetic','Reminder','reminder@example.test','email')", [customer, business])
    await db.query("insert into public.appointments(id,business_id,customer_id,title,starts_at,ends_at,status,created_at) values($1,$2,$3,'Synthetic arrival',now()+interval '24 hours',now()+interval '25 hours','confirmed',now()-interval '3 days')", [appointment, business, customer])
    await db.query("insert into private.managed_delivery_accounts(business_id,email_active,reply_to) values($1,true,'owner@example.test') on conflict(business_id) do update set email_active=true,reply_to=excluded.reply_to", [business])
    await db.query('set local role authenticated')
    const settings = (await db.query('select public.get_appointment_reminder_settings($1) value', [business])).rows[0].value
    assert.deepEqual(settings.rule, { enabled: false, lead_hours: 48, channel: 'email' })
    const invoiceDefaults = (await db.query('select public.get_delivery_automation($1) value', [business])).rows[0].value
    assert.equal(invoiceDefaults.rule.after_days, 2)
    assert.equal(invoiceDefaults.rule.enabled, false)
    await db.query("select public.save_appointment_reminder_settings($1,true,48,'email')", [business])
    await db.query('reset role')
    await db.query('commit')
    // An unrelated identity cannot read settings, change the appointment, or claim sends.
    await editor.query("select set_config('request.jwt.claim.sub',$1,false)", [outsider])
    await editor.query('set role authenticated')
    await assert.rejects(editor.query('select public.get_appointment_reminder_settings($1)', [business]), { code: '42501' })
    await assert.rejects(editor.query("select public.save_appointment_reminder_override($1,$2,'off',48,'email')", [business, appointment]), { code: '42501' })
    await assert.rejects(editor.query('select * from private.appointment_reminder_queue'), { code: '42501' })
    await assert.rejects(editor.query('select public.prepare_due_appointment_reminders()'), { code: '42501' })
    await editor.query('reset role')
    await db.query('select public.prepare_due_appointment_reminders()')
    const request = (await db.query("select id from private.appointment_reminder_queue where status='queued'")).rows[0]?.id
    assert.ok(request)
    await blocker.query('begin')
    await blocker.query("select pg_advisory_xact_lock(hashtextextended('tier-usage:'||$1||'email',0))", [business])
    const pid = (await claimant.query('select pg_backend_pid() pid')).rows[0].pid
    await claimant.query('set role service_role')
    // false bypasses only the beta recipient allowlist inside this isolated test;
    // no dispatcher or external provider is running.
    const pending = claimant.query('select public.claim_appointment_reminder($1,false) value', [request]).then(value => ({ value }), error => ({ error }))
    let waiting = false
    for (let i = 0; i < 100; i++) {
      waiting = (await db.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) waiting", [pid])).rows[0].waiting
      if (waiting) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.ok(waiting, 'Claim must reach the real quota lock')
    await editor.query("update public.customers set email='changed@example.test' where id=$1", [customer])
    await blocker.query('commit')
    const result = await pending
    if (result.error) throw result.error
    assert.equal(result.value.rows[0].value.status, 'blocked')
    assert.equal((await db.query('select count(*)::int n from private.tier_operations where business_id=$1', [business])).rows[0].n, 0)
    await editor.query("update public.appointments set starts_at=starts_at+interval '2 hours',ends_at=ends_at+interval '2 hours' where id=$1", [appointment])
    await db.query('select public.prepare_due_appointment_reminders()')
    const next = (await db.query("select id from private.appointment_reminder_queue where status='queued'")).rows[0]?.id
    assert.ok(next)
    await editor.query('set role service_role')
    const claims = await Promise.all([claimant, editor].map(c => c.query('select public.claim_appointment_reminder($1,false) value', [next])))
    assert.deepEqual(claims.map(r => r.rows[0].value.status).sort(), ['claimed', 'sending'])
    assert.equal((await db.query('select count(*)::int n from private.tier_operations where business_id=$1', [business])).rows[0].n, 1)
    await claimant.query("select public.finish_appointment_reminder($1,'uncertain',null)", [next])
    assert.equal((await claimant.query('select public.claim_appointment_reminder($1,false) value', [next])).rows[0].value.status, 'uncertain')
    return { defaultsOff: true, tenantDenial: true, quotaWaitRevalidation: true, concurrentSingleClaim: true, uncertainNotRetried: true }
  } finally {
    await blocker.query('rollback').catch(() => {})
    await db.query('rollback').catch(() => {})
    await Promise.all(peers.map(c => c.end().catch(() => {})))
    // Delete audited children while their parent still exists, so their delete
    // triggers can append activity without violating the business foreign key.
    await db.query('delete from public.appointments where id=$1', [appointment])
    await db.query('delete from public.customers where id=$1', [customer])
    await db.query('delete from public.businesses where id=$1', [business])
    await db.query('delete from auth.users where id=any($1::uuid[])', [[owner, outsider]])
  }
}
