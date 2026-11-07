import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import type { PoolClient } from 'pg'
import { connectedAgenda, externalRange } from '../../server/calendar/external.js'
import { CalendarError } from '../../server/calendar/errors.js'
const B='11111111-1111-4111-8111-111111111111', U='33333333-3333-4333-8333-333333333333', I='77777777-7777-4777-8777-777777777777'
const range=externalRange('2026-11-01','2026-11-08','America/New_York')
const event={id:'outside',title:'External meeting',description:'Bring plans',location:'1 Main Street',starts_at:'2026-11-02T15:00:00Z',ends_at:'2026-11-02T16:00:00Z',all_day:false,url:null}
async function setup() {
 const db = new PGlite()
 await db.exec(await readFile(new URL('./fixture.sql',import.meta.url),'utf8'))
 await db.exec(await readFile(new URL('../../supabase/migrations/20261102144435_calendar_sync_dashboard.sql',import.meta.url),'utf8'))
 await db.exec(`insert into auth.users values('${U}');insert into businesses values('${B}','America/New_York');insert into business_members values('${B}','${U}','owner');insert into private.calendar_integrations(id,business_id,user_id,provider,account_id,email,auto_sync) values('${I}','${B}','${U}','google','account','qa@example.test',false);`)
 return db
}
function transaction(db:PGlite) { return async <T>(fn:(db:PoolClient)=>Promise<T>)=>db.transaction(tx=>fn({query:(sql:string,values?:unknown[])=>tx.query(sql,values)} as unknown as PoolClient)) }
test('external ranges reject malformed, invalid-zone and oversized requests while preserving DST',()=>{
 assert.equal(range.from,'2026-11-01T04:00:00.000Z');assert.equal(range.to,'2026-11-08T05:00:00.000Z')
 for(const args of [['2026-02-30','2026-03-01','UTC'],['2026-11-01','2026-11-02','bad'],['2026-01-01','2027-01-01','UTC'],['2026-11-02','2026-11-01','UTC'],['2026-11-01T00:00','2026-11-02','UTC']]) assert.throws(()=>externalRange(...args as [string,string,string]),/invalid_calendar_range/)
})
test('personal imports enforce both business and user scope, exclude exported jobs, and work with outbound sync off',async()=>{
 const db=await setup();try{
  await db.query('insert into private.calendar_event_links(integration_id,source_key,calendar_id,calendar_event_id) values($1,$2,$3,$4)',[I,'job:local','primary','exported'])
  let calls=0;const rt={transaction:transaction(db),provider:()=>({events:async()=>{calls++;return [event,{...event,id:'exported'}]}})}
  const result=await connectedAgenda(B,U,range,rt)
  assert.equal(result.events.length,1);assert.equal(result.events[0].id,I+':outside');assert.equal(result.events[0].email,'qa@example.test');assert.equal(result.connections,1)
  assert.equal((await connectedAgenda(B,'99999999-9999-4999-8999-999999999999',range,rt)).events.length,0)
  assert.equal((await connectedAgenda('99999999-9999-4999-8999-999999999999',U,range,rt)).events.length,0);assert.equal(calls,1)
 }finally{await db.close()}
})
test('one revoked provider leaves the other usable, retains rotated credentials, and requests reconnection',async()=>{
 const db=await setup();try{
  await db.query("insert into private.calendar_integrations(business_id,user_id,provider,account_id,email) values($1,$2,'outlook','other','other@example.test')",[B,U])
  const rt={transaction:transaction(db),provider:(client:PoolClient,integration:{provider:string;id:string})=>({events:async()=>{if(integration.provider==='outlook')return [event];await client.query("update private.calendar_integrations set credentials=$2 where id=$1",[integration.id,JSON.stringify({rotated:true})]);throw new CalendarError('authorization_revoked')}})}
  const result=await connectedAgenda(B,U,range,rt)
  assert.equal(result.events.length,1);assert.equal(result.events[0].provider,'outlook');assert.deepEqual(result.issues,[{provider:'google',email:'qa@example.test',reconnect:true}])
  const row=(await db.query<{state:string;credentials:unknown}>('select state,credentials from private.calendar_integrations where id=$1',[I])).rows[0]
  assert.equal(row.state,'reconnect_required');assert.deepEqual(row.credentials,{rotated:true})
 }finally{await db.close()}
})
