const { randomUUID } = require('node:crypto')

module.exports = class FinQaWorkflow {
  id() {
    return 'fin-isolated-qa-workflow'
  }

  async callApi(prompt) {
    const { FIN_QA_ACCESS_TOKEN: token, FIN_QA_BUSINESS_ID: business, FIN_QA_INVOICE_NUMBER: invoiceNumber } = process.env
    if (!token || !/^[0-9a-f-]{36}$/i.test(business || '') || !/^[A-Z0-9-]{2,40}$/i.test(invoiceNumber || '')) {
      return { error: 'Set FIN_QA_ACCESS_TOKEN, FIN_QA_BUSINESS_ID and FIN_QA_INVOICE_NUMBER for the synthetic QA workspace.' }
    }
    const response = await fetch('https://ocmlvzkackufwpwnnsdb.supabase.co/functions/v1/fin-workflow', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ business_id: business, thread_id: randomUUID(), request_id: randomUUID(), text: prompt.replaceAll("%QA_INVOICE%", invoiceNumber) }),
      signal: AbortSignal.timeout(135_000),
    })
    const reply = await response.json()
    if (!response.ok) return { error: 'Fin returned HTTP ' + response.status + ': ' + (reply.error || 'Unknown error') }
    return { output: { ...reply, fixture_invoice_number: invoiceNumber } }
  }
}
