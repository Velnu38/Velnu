/** Runtime checks are required even when callers have TypeScript types. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function validDecimal(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7
}

export function validateDocumentInput(input: unknown): asserts input is Record<string, unknown> & { items: Array<{ description: string; quantity: number; unit_price: number; tax_rate?: number }> } {
  if (!isRecord(input) || typeof input.customer_id !== 'string' || !input.customer_id.trim()) throw new Error('Choose a customer')
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) throw new Error('Enter 1 to 50 line items')
  for (const field of ['due_date', 'expires_on']) {
    if (input[field] !== undefined && input[field] !== null && input[field] !== '' && !validCalendarDate(input[field])) throw new Error('Choose a valid document date')
  }
  for (const field of ['notes', 'customer_message', 'description', 'reason', 'schedule_note']) {
    const value = input[field]
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 4000)) throw new Error('Document text must be at most 4,000 characters')
  }
  for (const item of input.items) {
    if (!isRecord(item) || typeof item.description !== 'string' || !item.description.trim() || item.description.length > 4000) throw new Error('Every line item needs a valid description')
    if (!validDecimal(item.quantity, 0.01, 100000)) throw new Error('Enter a valid quantity with at most 2 decimal places')
    if (!validDecimal(item.unit_price, 0, 10000000)) throw new Error('Enter a valid unit price with at most 2 decimal places')
    if (!validDecimal(item.tax_rate ?? 0, 0, 100)) throw new Error('Tax rate must be between 0% and 100%, with at most 2 decimal places')
  }
}

export function validCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Supabase numeric columns may be JSON numbers or decimal strings. Fail closed. */
export function readFinancialNumber(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value))) throw new Error('Financial records contain an invalid amount. Reload before using totals.')
  const amount = Number(value)
  if (!Number.isFinite(amount) || Math.abs(amount) > Number.MAX_SAFE_INTEGER / 100) throw new Error('Financial records contain an unsupported amount.')
  return amount
}
