import test from 'node:test'
import assert from 'node:assert/strict'
import {currentSessionActor} from '../../supabase/functions/_shared/currentSession.ts'
import {attachmentHandler} from '../../supabase/functions/upload-attachment/handler.ts'
const auth={getUser:async()=>({data:{user:{id:'11111111-1111-4111-8111-111111111111'}},error:null})}
const user='11111111-1111-4111-8111-111111111111'
test('session RPC failures, revoked sessions and malformed responses deny uploads before privileged reservation',async()=>{
 for(const result of [{data:'22222222-2222-4222-8222-222222222222',error:null},{data:null,error:null},{data:user,error:{code:'42501'}},{data:'not-a-user',error:null}]){
  const client={auth,rpc:(name:string)=>{assert.equal(name,'current_session_actor');return {abortSignal:async()=>result}}}
  const handler=attachmentHandler({origins:[],authorize:()=>currentSessionActor(client),reserve:async()=>{throw Error('Unauthorized reservation')},upload:async()=>{throw Error('Unauthorized upload')},finish:async()=>{throw Error('Unauthorized finish')}})
  assert.equal((await handler(new Request('https://example.test',{method:'POST'}))).status,401)
 }
 assert.equal(await currentSessionActor({auth,rpc:()=>({abortSignal:async()=>{throw Error('network')}})}),null)
 assert.equal(await currentSessionActor({auth,rpc:()=>({abortSignal:async()=>({data:user,error:null})})}),user)
})

test('existing Auth identity rejection remains enforced before the session RPC',async()=>{
 assert.equal(await currentSessionActor({auth:{getUser:async()=>({data:{user:null},error:{message:'denied'}})},rpc:()=>{throw Error('must not reach RPC')}}),null)
})
