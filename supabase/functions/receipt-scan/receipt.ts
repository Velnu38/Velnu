type Field = {
  Type?: { Text?: string }
  ValueDetection?: { Text?: string; Confidence?: number }
  Currency?: { Code?: string }
}
type Expense = { SummaryFields?: Field[]; LineItemGroups?: { LineItems?: { LineItemExpenseFields?: Field[] }[] }[] }
type Scan = { ExpenseDocuments?: Expense[] }

function money(text: string | undefined): string | null {
  const value = text?.trim().replace(/^USD\s*/i, '').replace(/^\$\s*/, '')
  if (!value || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{2})?$/.test(value)) return null
  const amount = Number(value.replaceAll(',', ''))
  return amount >= 0 && amount <= 100_000_000 ? amount.toFixed(2) : null
}

function date(text: string | undefined): string | null {
  if (!text) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim())
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text.trim())
  if (!iso && !us) return null
  const parts = iso ? iso.slice(1) : [us![3], us![1].padStart(2, '0'), us![2].padStart(2, '0')]
  const value = parts.join('-'), parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null
}

function pick(fields: Field[], type: string): Field | undefined {
  return fields.filter(field => field.Type?.Text === type && field.ValueDetection?.Text?.trim())
    .sort((a, b) => (b.ValueDetection?.Confidence ?? 0) - (a.ValueDetection?.Confidence ?? 0))[0]
}

export function receiptDraft(scan: Scan) {
  if (scan.ExpenseDocuments?.length !== 1) return {
    vendor: null, date: null, total: null, tax: null, items: [],
    warning: 'Use one clear photo per receipt or enter the expense manually.',
  }
  const receipt = scan.ExpenseDocuments[0], fields = receipt.SummaryFields ?? []
  const vendor = pick(fields, 'VENDOR_NAME')?.ValueDetection
  const day = pick(fields, 'INVOICE_RECEIPT_DATE')?.ValueDetection
  const total = pick(fields, 'TOTAL')
  const tax = pick(fields, 'TAX')
  const nonUsd = fields.some(field => field.Currency?.Code && field.Currency.Code !== 'USD')
  const vendorName = (vendor?.Confidence ?? 0) >= 80 ? vendor?.Text?.trim().slice(0, 160) || null : null
  const expenseDate = (day?.Confidence ?? 0) >= 80 ? date(day?.Text) : null
  const amount = !nonUsd && (total?.ValueDetection?.Confidence ?? 0) >= 90 ? money(total?.ValueDetection?.Text) : null
  const items = (receipt.LineItemGroups ?? []).flatMap(group => group.LineItems ?? []).slice(0, 15)
    .map(line => pick(line.LineItemExpenseFields ?? [], 'ITEM')?.ValueDetection)
    .filter(item => item?.Text && (item.Confidence ?? 0) >= 80)
    .map(item => item!.Text!.trim().slice(0, 160))
  return {
    vendor: vendorName, date: expenseDate, total: amount === '0.00' ? null : amount,
    tax: !nonUsd && (tax?.ValueDetection?.Confidence ?? 0) >= 90 ? money(tax?.ValueDetection?.Text) : null,
    items,
    warning: nonUsd ? 'This receipt may use a different currency. Enter the expense amount in USD.'
      : !vendorName || !expenseDate || !amount || amount === '0.00' ? 'Check the receipt and fill in any missing details.' : '',
  }
}
