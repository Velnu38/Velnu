/** Conservative extraction of one-line invoices. Review is required before saving. */
export interface QuickInvoiceSeed {
  customerName: string
  description: string
  amount: string
  multipleAmounts: boolean
}

export function isQuickInvoiceCommand(value: string): boolean {
  return /\b(?:create|make|draft|prepare|write|generate|start)\b[\s\S]{0,100}\b(?:an?\s+)?invoice\b/i.test(value)
    || /\b(?:invoice|bill)\s+(?:for|to)\b/i.test(value)
    || /\b(?:bill)\s+(?:[A-Za-z][\w'-]*\s+){0,5}(?:for|\$)/i.test(value)
}

export function parseQuickInvoice(value: string): QuickInvoiceSeed {
  const command = value.trim().replace(/\s+/g, ' ')
  // Count distinct *mentions*, not distinct amounts: $100 labor + $100
  // materials is still a multi-price instruction. Currency followed by
  // "dollars" can match two patterns; overlapping spans describe one mention.
  const moneyMatches = [
    ...command.matchAll(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)\b/g),
    ...command.matchAll(/\b(\d[\d,]*(?:\.\d{1,2})?)\s+dollars?\b/gi),
  ].map(match => ({
    start: match.index,
    end: match.index + match[0].length,
    value: match[1].replaceAll(',', ''),
  })).sort((a, b) => a.start - b.start)
  const amounts: string[] = []
  let latestEnd = -1
  for (const match of moneyMatches) {
    if (match.start < latestEnd) continue
    // Never infer a positive invoice from a negative or refund amount.
    if (/[-−]\s*$/.test(command.slice(Math.max(0, match.start - 3), match.start))) continue
    amounts.push(match.value)
    latestEnd = match.end
  }
  const match = command.match(/\b(?:invoice|bill)\s+(?:for|to)\s+(.+?)(?=\s+(?:for|due|total|amount|at|with|including|on|description|service|work|to)\b|\s+\$|[,.;!?]|$)/i)
    ?? command.match(/\b(?:for|to)\s+([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){0,4}?)(?=\s+(?:for|due|total|amount|at|with|including|on|description|service|work)\b|\s+\$|[,.;!?]|$)/i)
  const name = (match?.[1] ?? '').trim().replace(/\b(?:in|the)\s*$/i, '').trim()
  const described = command.match(/\b(?:description|service|work)\s*:\s*(.+?)(?=\s+\$\s*\d|$)/i)
  return {
    customerName: name,
    description: described?.[1].trim().replace(/\s+(?:\$\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s+dollars?)\s*$/i, '').trim() ?? '',
    amount: amounts.length === 1 && Number(amounts[0]) > 0 ? amounts[0] : '',
    multipleAmounts: amounts.length > 1,
  }
}
