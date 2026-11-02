export type EntryDirection = 'income' | 'expense'

export interface WorkbookLine {
  id: string
  entry_date: string
  direction: EntryDirection
  description: string
  category: string
  amount: number
  currency: string
  source: 'invoice_payment' | 'manual' | 'quickbooks'
  source_label: string
  removable: boolean
  source_id?: string | null
  source_view?: 'invoices' | 'estimates' | 'work'
  source_reference?: string
  payment_method?: string | null
  notes?: string | null
}

