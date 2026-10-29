import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessReliabilityHealth, criticalReliabilityMetrics } from '../../.recovery-build/healthStatus.js'
const base = { email_stale: 0, email_uncertain: 0, failed_email_last_day: 0, sandbox_events_awaiting_reconciliation: 0 }
test('operational zero counts stay healthy', () => {
  assert.deepEqual(assessReliabilityHealth(base), { healthy: true, alerts: [], invalid: false })
})
for (const metric of criticalReliabilityMetrics) {
  test('critical signal '+metric+' makes monitor unhealthy', () => {
    const assessment = assessReliabilityHealth({ ...base, [metric]: 1 })
    assert.equal(assessment.healthy, false)
    assert.deepEqual(assessment.alerts, [metric])
  })
  test('missing critical signal '+metric+' fails closed', () => {
    const missing = { ...base }
    delete missing[metric]
    const assessment = assessReliabilityHealth(missing)
    assert.equal(assessment.healthy, false)
    assert.equal(assessment.invalid, true)
  })
}
test('invalid negative, fractional, string and non-finite counts fail closed', () => {
  for (const bad of [-1, 0.5, Infinity, NaN, '0', null]) {
    const assessment = assessReliabilityHealth({ ...base, email_stale: bad })
    assert.equal(assessment.healthy, false)
    assert.equal(assessment.invalid, true)
  }
})
test('1000 generated counter combinations match whether any alert is present', () => {
  for (let i=0;i<1000;i++){
    const metrics={email_stale:i%17===0?1:0,email_uncertain:i%13===0?1:0,
      failed_email_last_day:i%11===0?1:0,sandbox_events_awaiting_reconciliation:i%7===0?1:0}
    const expected=Object.values(metrics).every(value=>value===0)
    assert.equal(assessReliabilityHealth(metrics).healthy, expected, 'case '+i)
  }
})
