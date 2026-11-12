import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import pg from 'pg'

/** Independent connections represent replicas; only the owned disposable replay DB. */
export async function verifyAbuseCostReplay(db, databaseUrl){
 const url=new URL(databaseUrl)
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'54322')
 assert.equal(db.connectionParameters.host,'127.0.0.1');assert.equal(Number(db.connectionParameters.port),54322)
 assert.equal(Number((await db.query('select count(*) n from public.businesses')).rows[0].n),0)
 const clients=Array.from({length:20},()=>new pg.Client({connectionString:databaseUrl,statement_timeout:15000}))
 const resources={ai:{burst:12,cap:7200},receipt:{burst:6,cap:3600},upload:{burst:20,cap:18000},pdf:{burst:12,cap:7200},email:{burst:12,cap:6000},sms:{burst:6,cap:3000},public_link:{burst:60}}
 const results={}
 try{
  await Promise.all(clients.map(c=>c.connect()))
  for(const [resource,{burst,cap}] of Object.entries(resources)){
   const business=randomUUID(),actor=randomUUID()
   await db.query('truncate private.provider_burst_buckets,private.provider_daily_attempts')
   // Pre-fill to one remaining slot; precisely one replica can claim it.
   await db.query("insert into private.provider_burst_buckets values($1,'actor',$2,clock_timestamp()+make_interval(secs=>60.0-60.0/$3),clock_timestamp())",[resource,actor,burst])
   const reserve=c=>c.query('select private.reserve_provider_burst($1,$2,$3)',[resource,business,actor])
   const race=await Promise.allSettled(clients.map(reserve))
   assert.equal(race.filter(x=>x.status==='fulfilled').length,1,resource+' final burst slot')
   for(const r of race.filter(x=>x.status==='rejected'))assert.equal(JSON.parse(r.reason.message).code,'FINVIANT_BURST_LIMIT')
   await db.query("update private.provider_burst_buckets set theoretical_at=clock_timestamp()-interval '1 minute'")
   await reserve(clients[1])
   if(cap){
    await db.query('truncate private.provider_burst_buckets,private.provider_daily_attempts')
    await db.query("insert into private.provider_daily_attempts values($1,(clock_timestamp() at time zone 'UTC')::date,$2)",[resource,cap-1])
    const daily=await Promise.allSettled(clients.map((c,i)=>c.query('select private.reserve_provider_burst($1,$2,$3)',[resource,randomUUID(),randomUUID()])))
    assert.equal(daily.filter(x=>x.status==='fulfilled').length,1,resource+' final daily slot')
    for(const r of daily.filter(x=>x.status==='rejected'))assert.equal(JSON.parse(r.reason.message).code,'FINVIANT_DAILY_LIMIT')
    assert.equal((await db.query('select attempts from private.provider_daily_attempts')).rows[0].attempts,cap)
    // Rejected daily reservations do not leave business/actor buckets behind.
    assert.equal(Number((await db.query('select count(*) n from private.provider_burst_buckets')).rows[0].n),3)
    await db.query('update private.provider_daily_attempts set period=period-1')
    await reserve(clients[2])
    assert.equal((await db.query('select attempts from private.provider_daily_attempts')).rows[0].attempts,1)
   }
   results[resource]={independentConnections:20,finalBurstSlotWinners:1,cooldownRecovery:true,...(cap?{finalDailySlotWinners:1,dailyRecovery:true,denialRollback:true}:{})}
  }
  return {resources:results,providerCalls:0}
 }finally{
  await Promise.allSettled(clients.map(c=>c.end()))
  await db.query('truncate private.provider_burst_buckets,private.provider_daily_attempts')
 }
}
