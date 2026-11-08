import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as tick } from 'node:timers/promises'
import { createBusinessRefreshCoordinator, listenToBusinessChanges } from '../../src/lib/businessRefreshHub.ts'

const business='11111111-1111-4111-8111-111111111111'
function fixture() {
  let editing=false,id=0,connections=0,closed=0
  const timeouts=new Map<number,()=>void>(),intervals=new Map<number,()=>void>(),notify=new Map<string,()=>void>()
  const window=Object.assign(new EventTarget(),{
    setTimeout(fn:()=>void){timeouts.set(++id,fn);return id},clearTimeout(id:number){timeouts.delete(id)},
    setInterval(fn:()=>void){intervals.set(++id,fn);return id},clearInterval(id:number){intervals.delete(id)},
  })
  const document=Object.assign(new EventTarget(),{hidden:false})
  const coordinator=createBusinessRefreshCoordinator({window:window as any,document:document as any,isEditing:()=>editing,
    listen:(business,callback)=>{connections++;notify.set(business,callback);return()=>{closed++;notify.delete(business)}},
  })
  return{window,document,coordinator,timeouts,intervals,notify,get connections(){return connections},get closed(){return closed},
    edit(value:boolean){editing=value},async flush(){for(const[k,fn]of[...timeouts]){timeouts.delete(k);fn()}await tick()},poll(){for(const fn of intervals.values())fn()},
  }
}

test('one business shares its subscription, debounces events and cleans up after the last view',async()=>{
  const f=fixture();let first=0,second=0
  const stopFirst=f.coordinator.subscribe(business,()=>{first++}),stopSecond=f.coordinator.subscribe(business,()=>{second++})
  assert.equal(f.connections,1)
  f.notify.get(business)!();f.notify.get(business)!();f.notify.get(business)!()
  await f.flush();assert.equal(first,1);assert.equal(second,1)
  stopFirst();assert.equal(f.closed,0);stopSecond();assert.equal(f.closed,1);assert.equal(f.intervals.size,0);assert.equal(f.timeouts.size,0)
})
test('dirty forms and hidden pages postpone refresh until polling or focus can safely refresh reads',async()=>{
  const f=fixture();let refreshed=0
  const stop=f.coordinator.subscribe(business,()=>{refreshed++})
  f.edit(true);f.notify.get(business)!();await f.flush();assert.equal(refreshed,0)
  f.edit(false);f.document.hidden=true;f.poll();await f.flush();assert.equal(refreshed,0)
  f.document.hidden=false;f.window.dispatchEvent(new Event('focus'));await f.flush();assert.equal(refreshed,1)
  stop()
})
test('in-flight read callbacks coalesce another change without concurrent reads or discarded latest updates',async()=>{
  const f=fixture();let refreshed=0,resolve:()=>void=()=>{}
  const pending=new Promise<void>(done=>{resolve=done})
  const stop=f.coordinator.subscribe(business,()=>{refreshed++;return refreshed===1?pending:undefined})
  f.notify.get(business)!();await f.flush();f.notify.get(business)!();await f.flush();assert.equal(refreshed,1)
  resolve();await tick();await f.flush();assert.equal(refreshed,2)
  stop()
})
test('removed views and events for another business never run a stale refresh',async()=>{
  const f=fixture();let refreshed=0
  const stop=f.coordinator.subscribe(business,()=>{refreshed++})
  const event=new Event('finviant-work-changed');Object.assign(event,{detail:{businessId:'22222222-2222-4222-8222-222222222222'}})
  f.window.dispatchEvent(event);await f.flush();assert.equal(refreshed,0)
  f.notify.get(business)!();stop();await f.flush();assert.equal(refreshed,0)
})
test('Realtime carries only the minimal business signal with exact tenant filters and no raw financial rows',()=>{
  const subscriptions:any[]=[],notifications:any[]=[],removed:any[]=[]
  const channel={on(type:string,filter:any,callback:()=>void){subscriptions.push({type,filter,callback});return channel},subscribe(callback:(state:string)=>void){callback('SUBSCRIBED');return channel}}
  const client={channel(name:string){assert.equal(name,'finviant-business:'+business);return channel},removeChannel(value:any){removed.push(value);return Promise.resolve('ok')}}
  const stop=listenToBusinessChanges(client as any,business,()=>{notifications.push(true)})
  assert.equal(notifications.length,1)
  assert.deepEqual(subscriptions.map(s=>s.filter),[
    {event:'INSERT',schema:'public',table:'business_activity',filter:'business_id=eq.'+business},
    {event:'UPDATE',schema:'public',table:'business_activity',filter:'business_id=eq.'+business},
  ])
  stop();assert.equal(removed[0],channel)
})
