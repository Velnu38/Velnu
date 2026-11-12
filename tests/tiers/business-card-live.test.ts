import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,user,plan,B,U,O} from './fixture';
import {parseContactCards} from '../../src/lib/contactImport';
const migration='supabase/migrations/20261112231049_stable_business_card_contact.sql';
const details={name:'Renée, Services',phone:'+17575550123',email:'hello@example.test',website:'https://example.test/a?b=1,2',tagline:'Repairs',include_address:false,street:'PRIVATE HOME',city:'City',region:'VA',postal_code:'23320'};
async function setup(){const db=await fixture();await db.exec('reset role');await db.exec(await readFile('supabase/migrations/20261108165736_e_business_card.sql','utf8'));await db.exec(await readFile('supabase/migrations/20261108172645_business_card_links.sql','utf8'));
// Reuse the actual shared public-link limiter (no provider call or stub).
const burst=await readFile('supabase/migrations/20261110165000_shared_provider_burst_limits.sql','utf8');await db.exec(burst.slice(0,burst.indexOf('--',burst.indexOf('revoke all on function private.reserve_provider_burst'))));
const caps=await readFile('supabase/migrations/20261112212813_abuse_cost_backpressure.sql','utf8');await db.exec(caps.slice(0,caps.indexOf('-- Guard the transition')));
await db.exec(await readFile(migration,'utf8'));await user(db);const r=(await val(db,'select save_business_card($1,$2,null) v',[B,details])).revision;return {db,r};}
const val=async(db:any,q:string,args:unknown[]=[]) => (await db.query(q,args)).rows[0].v;
const publish=(db:any,r:string,on=true)=>val(db,'select set_live_business_card($1,$2,$3) v',[B,r,on]);
const read=(db:any,id:string)=>val(db,'select get_live_business_card($1) v',[id]);
async function anon(db:any){await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role anon");}
test('opt-in stable website survives published edits, preserves external website/Unicode and unpublishes without exposing private fields',async()=>{const {db,r}=await setup();try{
 let v=await val(db,'select export_business_card($1,$2) v',[B,r]);assert.doesNotMatch(v.vcard,/finviant.com/);
 const link=await publish(db,r);const id=new URL(link.url).searchParams.get('business_card')!;assert.notEqual(id,B);
 await val(db,'select publish_business_card($1,$2,$3) v',[B,r,'a'.repeat(64)]);
 v=await val(db,'select export_business_card($1,$2) v',[B,r]);const preview=await val(db,'select get_shared_business_card($1) v',['a'.repeat(64)]);assert.equal(preview.vcard,v.vcard);const unfolded=v.vcard.replace(/\r\n /g,'');const websites=unfolded.split('\r\n').filter((x:string)=>x.startsWith('URL:')).map((x:string)=>x.slice(4));assert.deepEqual(websites,[link.url,details.website]);const imported=parseContactCards(v.vcard,()=>crypto.randomUUID()).contacts[0];assert.equal(imported.email,details.email);assert.equal(imported.phone,details.phone);assert.match(imported.first_name,/Renée/);assert.match(unfolded,/FN:Renée\\, Services/);
 await anon(db);let publicCard=await read(db,id);assert.equal(publicCard.card.street,undefined);assert.equal(publicCard.business_id,undefined);assert.doesNotMatch(JSON.stringify(publicCard),/PRIVATE HOME/);assert.equal(await read(db,B),null);
 await assert.rejects(db.query('select * from private.business_card_publications'),/permission denied/);
 await user(db);const next=(await val(db,'select save_business_card($1,$2,$3) v',[B,{...details,name:'Updated'},r])).revision;
 assert.equal((await read(db,id)).card.name,details.name,'unpublished edits stay private');assert.equal((await publish(db,next)).url,link.url);assert.equal((await read(db,id)).card.name,'Updated');
 await publish(db,next,false);await anon(db);assert.equal(await read(db,id),null);await user(db);assert.equal((await publish(db,next)).url,link.url);
 await plan(db,'basic');assert.equal(await read(db,id),null);
 }finally{await db.close();}});
test('publication and exports reject foreign business, staff, anonymous and stale revisions',async()=>{const {db,r}=await setup();try{
 await user(db,O);await assert.rejects(publish(db,r),/Primary/);await user(db);await assert.rejects(publish(db,crypto.randomUUID()),/current/);
 await assert.rejects(val(db,'select set_live_business_card($1,$2,true) v',[crypto.randomUUID(),r]),/Primary/);
 await anon(db);await assert.rejects(publish(db,r),/permission denied/);await assert.rejects(val(db,'select export_business_card($1,$2) v',[B,r]),/permission denied/);
 }finally{await db.close();}});
test('estimate requests route only to the published business, retry once, bound spam and create no outbound delivery',async()=>{const {db,r}=await setup();try{
 const link=await publish(db,r),id=new URL(link.url).searchParams.get('business_card')!,request=crypto.randomUUID();
 const send=(req=request,p=id,name='Customer')=>val(db,'select request_business_card_estimate($1,$2,$3,$4,$5) v',[p,req,name,'customer@example.test','Please provide an estimate']);
 await anon(db);assert.equal((await send()).received,true);assert.equal((await send()).received,true);await assert.rejects(send(request,id,'Changed'),/changed/);await assert.rejects(send(crypto.randomUUID(),B),/unavailable/);
 await assert.rejects(val(db,'select request_business_card_estimate($1,$2,$3,$4,$5) v',[id,crypto.randomUUID(),'Customer','customer@example.test','x'.repeat(2001)]),/2000/);
 for(let n=1;n<20;n++)await send(crypto.randomUUID());await assert.rejects(send(crypto.randomUUID()),/Too many/);
 await user(db);const state=await val(db,'select get_business_card($1) v',[B]);assert.equal(state.live_requests.length,20);assert.match(state.live_requests[0].body,/Customer/);
 await db.exec('reset role');assert.equal((await db.query<any>("select count(*)::int n from messages where business_id=$1 and direction='inbound' and status='received'",[B])).rows[0].n,20);
 assert.equal((await db.query<any>('select count(*)::int n from private.finviant_email_outbox')).rows[0].n,0);
 await user(db);await publish(db,r,false);await anon(db);await assert.rejects(send(),/unavailable/);
 }finally{await db.close();}});

test('new email attachments freeze the stable link once and preserve it on retries after unpublishing',async()=>{const {db,r}=await setup();try{
 const link=await publish(db,r),request=crypto.randomUUID();await db.exec('reset role');await db.query("insert into private.managed_delivery_accounts(business_id,email_active,reply_to) values($1,true,'owner@example.test')",[B]);
 const prepare=()=>val(db,'select prepare_business_card_email($1,$2,$3,$4,$5) v',[U,B,request,'customer@example.test',r]);await prepare();
 const payload=async()=> (await db.query<any>('select payload from private.finviant_email_outbox where id=$1',[request])).rows[0].payload;
 const frozen=await payload();assert.ok(Buffer.from(frozen.attachments[0].content,'base64').toString().replace(/\r\n /g,'').includes('URL:'+link.url));
 await user(db);await publish(db,r,false);await db.exec('reset role');await prepare();assert.deepEqual(await payload(),frozen);
 }finally{await db.close();}});
test('two published businesses receive only their own requests and cannot reuse another card request ID',async()=>{const {db,r}=await setup();try{
 const first=await publish(db,r),firstId=new URL(first.url).searchParams.get('business_card')!,other=crypto.randomUUID();
 await db.exec('reset role');await db.query('delete from business_members where business_id=$1 and user_id=$2',[B,O]);await db.query("insert into businesses(id,name,created_by_user_id,email) values($1,'Other business',$2,'other@example.test')",[other,O]);await db.query("insert into business_members(business_id,user_id,role) values($1,$2,'owner')",[other,O]);await db.query("insert into private.business_entitlements(business_id,plan) values($1,'pro')",[other]);await user(db,O);
 const secondRevision=(await val(db,'select save_business_card($1,$2,null) v',[other,{...details,name:'Other business'}])).revision;
 const second=await val(db,'select set_live_business_card($1,$2,true) v',[other,secondRevision]),secondId=new URL(second.url).searchParams.get('business_card')!;
 await assert.rejects(val(db,'select get_business_card($1) v',[B]),/access denied/);
 await anon(db);const request=crypto.randomUUID();const send=(publicId:string,requestId:string)=>val(db,'select request_business_card_estimate($1,$2,$3,$4,$5) v',[publicId,requestId,'Customer','customer@example.test','Repair request']);await send(firstId,request);await assert.rejects(send(secondId,request),/changed/);await send(secondId,crypto.randomUUID());
 await user(db,O);const secondState=await val(db,'select get_business_card($1) v',[other]);assert.equal(secondState.live_requests.length,1);assert.notEqual(secondState.live_requests[0].id,request);
 await user(db);const firstState=await val(db,'select get_business_card($1) v',[B]);assert.equal(firstState.live_requests.length,1);assert.equal(firstState.live_requests[0].id,request);await assert.rejects(val(db,'select get_business_card($1) v',[other]),/access denied/);
 }finally{await db.close();}});
