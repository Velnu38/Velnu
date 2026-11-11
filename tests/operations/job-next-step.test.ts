import test from 'node:test'
import assert from 'node:assert/strict'
import {jobNextStep} from '../../src/lib/jobNextStep.ts'
import {jobsPreferenceKey,preferredJobsWorkspace} from '../../src/lib/jobWorkspacePreference.ts'
const base={status:'in_progress',ready:true,canEdit:true,canSchedule:true,canBill:true,booked:true,crew:true,futureVisit:false,remainingVisits:false,tasks:0,materials:0,changes:0}
test('job next actions follow the actual blocker and preserve completion as a review',()=>{
  for(const [patch,action] of [[{},'complete'],[{tasks:2},'tasks'],[{materials:1,tasks:2},'materials'],[{changes:1},'changes'],[{crew:false},'crew'],[{remainingVisits:true},'visits'],[{status:'lead',booked:false},'schedule'],[{status:'scheduled',futureVisit:true},'visits'],[{status:'scheduled'},'start'],[{status:'canceled'},'history'],[{status:'completed'},'invoice']] as const)assert.equal(jobNextStep({...base,...patch}).action,action)
  assert.equal(jobNextStep(base).label,'Review completion')
  assert.equal(jobNextStep({...base,status:'completed',invoice:{status:'paid'}}).label,'View payment history')
})
test('unavailable and restricted work cannot imply readiness or expose billing actions',()=>{
  assert.equal(jobNextStep({...base,ready:false}).action,'overview')
  assert.equal(jobNextStep({...base,canEdit:false,tasks:2}).action,'overview')
  assert.equal(jobNextStep({...base,canBill:false,status:'completed'}).action,'history')
  assert.equal(jobNextStep({...base,canBill:false,changes:2}).action,'complete')
  assert.equal(jobNextStep({...base,status:'lead',booked:false,canSchedule:false}).action,'visits')
})
test('workspace preference is user/business scoped and never overrides explicit intent',()=>{
  assert.notEqual(jobsPreferenceKey('a','one'),jobsPreferenceKey('b','one'))
  assert.notEqual(jobsPreferenceKey('a','one'),jobsPreferenceKey('a','two'))
  assert.equal(preferredJobsWorkspace('?view=work',null),'jobs')
  assert.equal(preferredJobsWorkspace('?view=work','management'),'management')
  for(const search of ['?new=1','?document=x','?customer=x','?schedule=1','?workspace=jobs','?job=x'])assert.equal(preferredJobsWorkspace(search,'management'),'jobs')
  assert.equal(preferredJobsWorkspace('?workspace=management&job=x&section=tasks','jobs'),'management')
  assert.equal(preferredJobsWorkspace('?view=work','invalid'),'jobs')
})
