const { randomUUID } = require('node:crypto')

module.exports = class FinQaWorkflow {
  id() {
    return 'fin-isolated-qa-workflow'
  }

  async callApi(prompt) {
    const { FIN_QA_ACCESS_TOKEN: token, FIN_QA_BUSINESS_ID: business } = process.env
    if (!token || !/^[0-9a-f-]{36}$/i.test(business || '')) {
      return { error: 'Set FIN_QA_ACCESS_TOKEN and FIN_QA_BUSINESS_ID for the synthetic QA workspace.' }
    }
    const response = await fetch('https://ocmlvzkackufwpwnnsdb.supabase.co/functions/v1/fin-workflow', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ business_id: business, thread_id: randomUUID(), request_id: randomUUID(), text: prompt }),
      signal: AbortSignal.timeout(135_000),
    })
    if (!response.ok) return { error: 'Fin returned HTTP ' + response.status }
    return { output: await response.json() }
  }
}
