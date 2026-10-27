/** Fail-closed operational health assessment. No customer data is needed. */
export const criticalReliabilityMetrics = [
  'email_stale',
  'email_uncertain',
  'failed_email_last_day',
  'sandbox_events_awaiting_reconciliation',
] as const

export type ReliabilityMetric = typeof criticalReliabilityMetrics[number]

export function assessReliabilityHealth(metrics: Record<string, unknown>): { healthy: boolean; alerts: ReliabilityMetric[]; invalid: boolean } {
  const alerts: ReliabilityMetric[] = []
  let invalid = false
  for (const key of criticalReliabilityMetrics) {
    const value = metrics[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      invalid = true
      alerts.push(key)
    } else if (value > 0) {
      alerts.push(key)
    }
  }
  return { healthy: !invalid && alerts.length === 0, alerts, invalid }
}
