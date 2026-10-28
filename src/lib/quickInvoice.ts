/** Conservative extraction of one-line invoices. Review is required before saving. */
export interface QuickInvoiceSeed {
  customerName: string
  description: string
  amount: string
  multipleAmounts: boolean
}

export function isQuickInvoiceCommand(value: string): boolean {
  if (typeof value !== 'string') return false
  return /\b(?:create|make|draft|prepare|write|generate|start)\b[\s\S]{0,100}\b(?:an?\s+)?invoice\b/i.test(value)
    || /\b(?:invoice|bill)\s+(?:for|to)\b/i.test(value)
    || /\b(?:bill)\s+(?:[A-Za-z][\w'-]*\s+){0,5}(?:for|\$)/i.test(value)
}

export function parseQuickInvoice(value: string): QuickInvoiceSeed {
  if (typeof value !== 'string') throw new Error('A text invoice command is required')
  const command = value.trim().replace(/\s+/g, ' ')
  // Count distinct *mentions*, not distinct amounts: $100 labor + $100
  // materials is still a multi-price instruction. Currency followed by
  // "dollars" can match two patterns; overlapping spans describe one mention.
  const moneyMatches = [
    // Capture the complete numeric token before validating it. Matching only
    // two decimal places can turn "$1.999" into "$1" through backtracking.
    ...command.matchAll(/\$\s*([+−-]?\s*\d[\d,.]*(?:[eE][+-]?\d+)?)\b/g),
    ...command.matchAll(/(?<![\w.])([+−-]?\s*\d[\d,.]*(?:[eE][+-]?\d+)?)\s+dollars?\b/gi),
  ].map(match => ({
    start: match.index,
    end: match.index + match[0].length,
    value: match[1],
  })).sort((a, b) => a.start - b.start)
  const amounts: string[] = []
  let latestEnd = -1
  let unsafeAmount = /\b(?:refund|credit|discount|minus|negative)\b/i.test(command)
  for (const match of moneyMatches) {
    if (match.start < latestEnd) continue
    // Consume the whole mention even when invalid. Otherwise the overlapping
    // "100 dollars" in "-$100 dollars" can reintroduce a positive amount.
    latestEnd = match.end
    const negativePrefix = /[-−(]\s*$/.test(command.slice(0, match.start))
    const validToken = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(match.value)
    const trailing = command.slice(match.end)
    const incompleteToken = /^[\w,]|^\.\d/.test(trailing)
    const normalized = match.value.replaceAll(',', '')
    if (negativePrefix || !validToken || incompleteToken || !Number.isFinite(Number(normalized)) || Number(normalized) > 10000000) unsafeAmount = true
    amounts.push(normalized)
  }
  const match = command.match(/\b(?:invoice|bill)\s+(?:for|to)\s+(.+?)(?=\s+(?:for|due|total|amount|at|with|including|on|description|service|work|to)\b|\s+\$|[,.;!?]|$)/i)
    ?? command.match(/\b(?:for|to)\s+([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){0,4}?)(?=\s+(?:for|due|total|amount|at|with|including|on|description|service|work)\b|\s+\$|[,.;!?]|$)/i)
  const name = (match?.[1] ?? '').trim().replace(/\b(?:in|the)\s*$/i, '').trim()
  const described = command.match(/\b(?:description|service|work)\s*:\s*(.+?)(?=\s+\$\s*\d|$)/i)
  return {
    customerName: name,
    description: described?.[1].trim().replace(/\s+(?:\$\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s+dollars?)\s*$/i, '').trim() ?? '',
    amount: !unsafeAmount && amounts.length === 1 && Number(amounts[0]) > 0 ? amounts[0] : '',
    multipleAmounts: amounts.length > 1,
  }
}
