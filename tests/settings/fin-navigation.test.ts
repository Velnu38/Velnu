import {test} from 'node:test'
import assert from 'node:assert/strict'
import {resolveFinNavigation,finDestination,assertFinNavigationAccess} from '../../src/lib/finNavigation.ts'
import type {CurrentBusiness} from '../../src/lib/business.ts'
const owner={id:'business-a',role:'owner',primary_owner:true} as CurrentBusiness
const usage={ai_limit:100,voice_limit:100,plan:'pro'}
test('clear typed or transcribed requests map to exact existing destinations',()=>{
 for(const request of ['Can you please open customer reminders?','Open customer reminders','Please take me to customer reminder settings.','Set up customer reminders','Create a customer reminder','customer reminders'])assert.deepEqual(resolveFinNavigation(request),{destination:'customerReminders'})
 assert.equal(finDestination('customerReminders').href,'/?view=settings&section=customer_reminders')
 assert.equal(finDestination('followups').href,'/?view=reminders')
 assert.deepEqual(resolveFinNavigation('Open internal follow-ups'),{destination:'followups'})
 assert.equal(finDestination('calendar').href,'/?view=settings&section=calendar')
 assert.equal(finDestination('jobs').href,'/?view=work&workspace=jobs')
 assert.equal(finDestination('jobManagement').href,'/?view=work&workspace=management')
 assert.equal(finDestination('team').href,'/?view=settings&section=team')
 for(const request of ['Open invoices','Open invoices'])assert.deepEqual(resolveFinNavigation(request),{destination:'invoices'})
})
test('context is bounded to a known destination; ambiguity and missing routes are honest',()=>{
 assert.deepEqual(resolveFinNavigation('Open that','customerReminders'),{destination:'customerReminders'})
 for(const request of ['Open reminders','Open that','Open payroll','Open invoice INV-99','Open https://evil.test','Open __proto__'])assert.ok('clarification' in resolveFinNavigation(request)!)
 assert.throws(()=>finDestination('__proto__' as any))
})
test('consequential actions remain in the review flow',()=>{
 for(const request of ['Show me what Jane owes','Show me unpaid invoices','Send reminders to customers','Enable customer reminders','Create invoice for $200','Open invoices and send them','Delete all jobs','Save reminder settings'])assert.equal(resolveFinNavigation(request),null)
})
test('fresh tenant, role, module and plan checks fail closed before navigation',()=>{
 assert.equal(assertFinNavigationAccess(owner.id,owner,'customerReminders',usage).href,'/?view=settings&section=customer_reminders')
 for(const business of [null,{...owner,id:'business-b'},{...owner,role:'stranger'}])assert.throws(()=>assertFinNavigationAccess(owner.id,business as any,'home',usage))
 for(const value of [null,{...usage,ai_limit:0},{...usage,voice_limit:0}])assert.throws(()=>assertFinNavigationAccess(owner.id,owner,'home',value))
 assert.throws(()=>assertFinNavigationAccess(owner.id,{...owner,role:'viewer',primary_owner:false,access_modules:[]},'invoices',usage))
 assert.throws(()=>assertFinNavigationAccess(owner.id,{...owner,role:'office',primary_owner:false,access_modules:['calendar','jobs']},'customerReminders',usage))
 assert.throws(()=>assertFinNavigationAccess(owner.id,owner,'calendar',{...usage,plan:'free'}))
})
