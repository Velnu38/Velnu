import { readFileSync, existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
const token=process.env.GITHUB_TOKEN, repo=process.env.GITHUB_REPOSITORY, branch=process.env.QA_BRANCH
if(!token||!repo||!branch)throw new Error('GitHub publication configuration missing')
const headers={authorization:'Bearer '+token,accept:'application/vnd.github+json','content-type':'application/json','X-GitHub-Api-Version':'2022-11-28'}
class ApiError extends Error { constructor(status,message){super(message);this.status=status} }
const transient=status=>status===408||status===429||status>=500
async function api(path,init={}){
 let last
 for(let attempt=1;attempt<=5;attempt++){
  try{
   const r=await fetch('https://api.github.com/repos/'+repo+path,{...init,headers,signal:AbortSignal.timeout(30000)})
   const raw=await r.text();let data
   try{data=raw?JSON.parse(raw):{}}catch{data={message:raw.slice(0,500)}}
   if(r.ok)return data
   const error=new ApiError(r.status,'GitHub publication failed: '+r.status+' '+(data.message??'Unknown response'))
   if(!transient(r.status)||attempt===5)throw error
   last=error
  }catch(error){
   if(error instanceof ApiError&&!transient(error.status))throw error
   last=error
   if(attempt===5)throw error
  }
  await delay(500*2**(attempt-1))
 }
 throw last
}
async function save(path,content){
 for(let attempt=1;attempt<=3;attempt++){
  const current=await api('/contents/'+path+'?ref='+encodeURIComponent(branch))
  try{
   await api('/contents/'+path,{method:'PUT',body:JSON.stringify({message:'Record Finviant infrastructure QA results [skip ci]',branch,sha:current.sha,content:Buffer.from(content).toString('base64')})})
   return
  }catch(error){
   if(error.status!==409||attempt===3)throw error
   await delay(500*attempt)
  }
 }
}
const log=JSON.parse(readFileSync('STRESS_TEST_LOGS.json','utf8'))
if(process.env.EXPECT_BROWSER_RESULTS==='true'){
 const path='browser/browser-results.json'
 const add=(message,detail={})=>{log.errors.push({time:new Date().toISOString(),scope:'browser-infrastructure',category:'browser',message,...detail});log.totals.failed++}
 if(!existsSync(path)){log.browser={status:'unavailable'};add('Browser/regression artifact unavailable; inspect the workflow job for the setup or regression failure.')}
 else {
  try {
   const report=JSON.parse(readFileSync(path,'utf8'));log.browser={stats:report.stats,errors:report.errors??[]}
   for(const error of report.errors??[])add(error.message??'Browser runner error',{detail:error})
   function visit(suites){for(const suite of suites??[]){for(const spec of suite.specs??[])for(const test of spec.tests??[])for(const result of test.results??[])if(!['passed','skipped'].includes(result.status))add(spec.title,{file:spec.file,status:result.status,errors:result.errors??[]});visit(suite.suites)}}visit(report.suites)
  } catch(e){add('Unable to parse browser results: '+e.message)}
 }
 if(log.totals.failed)log.status='completed_with_failures'
}
const text=JSON.stringify(log,null,2)+'\n' 
await save('STRESS_TEST_LOGS.json',text)
const source=await api('/contents/ASSESSMENT_REPORT.md?ref='+encodeURIComponent(branch));let report=Buffer.from(source.content,'base64').toString('utf8')
const status=['<!-- CAMPAIGN_STATUS_START -->',`Updated: ${log.updated_at}. Status: **${log.status}**. Verified accumulated campaign duration: **${Math.round(log.active_seconds)} seconds** of the required 28,800 seconds.`,`Profiles exercised: ${log.totals.profiles_checked}; successful service checks: ${log.totals.passed}; failures: ${log.totals.failed}; expected input rejections: ${log.totals.expected_rejections}; live edge probes: ${log.totals.edge_probes}.`,`Workflow: https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,`The JSON log contains every observed unexpected exception and per-function counts. A nonzero failure count remains a finding and does not become a pass when a job finishes.`,'<!-- CAMPAIGN_STATUS_END -->'].join('\n\n')
report=report.replace(/<!-- CAMPAIGN_STATUS_START -->[\s\S]*?<!-- CAMPAIGN_STATUS_END -->/,status)
await save('ASSESSMENT_REPORT.md',report)
console.log('Published root report and JSON log to '+branch)
