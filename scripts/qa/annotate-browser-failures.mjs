import {readFileSync} from 'node:fs'
import {relative} from 'node:path'

// Keep failed synthetic-browser assertions visible through GitHub's Checks API,
// including environments that cannot download Actions log/artifact archives.
const path=process.argv[2]||'test-results/results.json'
let report
try{report=JSON.parse(readFileSync(path,'utf8'))}catch{console.log('Browser JSON report is unavailable. See the test step for build/startup failures.');process.exit(0)}
const escape=value=>String(value).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A')
function walk(suite){
 for(const spec of suite.specs||[])for(const test of spec.tests||[]){
  const failed=(test.results||[]).find(result=>['failed','timedOut','interrupted'].includes(result.status))
  if(!failed)continue
  const file=spec.file?.startsWith('/')?relative(process.cwd(),spec.file):spec.file||'tests/e2e'
  const message=(failed.errors||[]).map(error=>error.message||'').join('\n').replace(/\u001b\[[0-9;]*m/g,'').slice(0,1400)
  console.log(`::error file=${escape(file)},line=${spec.line||1},title=Browser regression::${escape(`${spec.title}\n${message}`)}`)
 }
 for(const child of suite.suites||[])walk(child)
}
walk(report)
