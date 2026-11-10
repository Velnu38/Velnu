import test from 'node:test'
import assert from 'node:assert/strict'
import {QUEUE_LIMITS,ownedQueueTarget} from '../../scripts/qa/queue-catchup.mjs'
test('queue catch-up refuses hosted targets and restricts its local fixture and dispatch budget',()=>{
 const local='postgresql://postgres:local@127.0.0.1:54322/postgres',id='finviant-replay-a0b1c2d3'
 assert.equal(ownedQueueTarget(local,id),local)
 for(const target of ['postgresql://postgres:local@db.xvybcmyoblfgzokaifsx.supabase.co:54322/postgres',local+'?host=remote',local+'#remote',local.replace('127.0.0.1','localhost'),local.replace('54322','5432'),local.replace('/postgres','/live')])assert.throws(()=>ownedQueueTarget(target,id))
 for(const project of ['xvybcmyoblfgzokaifsx','ocmlvzkackufwpwnnsdb','--all','finviant-replay-a0b1c2d3;restart'])assert.throws(()=>ownedQueueTarget(local,project))
 assert.equal(QUEUE_LIMITS.workspaces,300);assert.equal(QUEUE_LIMITS.dispatchers,4);assert.ok(QUEUE_LIMITS.claimCeiling<=2400);assert.ok(QUEUE_LIMITS.timeoutMs<=120000)
})
