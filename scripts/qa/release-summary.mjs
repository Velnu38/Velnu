import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

const name = process.argv[2]
const hosted = name === 'Signed-in release assessment'
const report = hosted ? 'test-results/hosted-qa-results.json' : 'test-results/release-qa.json'
const heading = '### ' + name
const ref = 'Workflow commit ' + (process.env.GITHUB_SHA || 'local run')
let details = 'No browser report was written. See the setup and test logs for the blocking step.'
if (existsSync(report)) {
  const { stats, errors } = JSON.parse(readFileSync(report, 'utf8'))
  const counts = {
    passed: stats.expected,
    failed: stats.unexpected,
    flaky: stats.flaky,
    skipped: stats.skipped,
    runnerErrors: errors?.length || 0,
  }
  details = Object.entries(counts).map(([label, count]) => label + ' ' + count).join(' · ')
  if (hosted) {
    // The repository is public. Publish counts only for runs with real sessions.
    writeFileSync('test-results/hosted-qa-counts.json', JSON.stringify({ commit: process.env.GITHUB_SHA, ...counts }, null, 2) + '\n')
  }
}
const summary = [heading, '', ref, '', details, ''].join('\n')
console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n')
