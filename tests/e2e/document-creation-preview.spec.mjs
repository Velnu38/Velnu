import {reviewDocument,openInvoiceOptions,addDocumentItem} from './invoice-creation-navigation.mjs'
import { test, expect } from '@playwright/test'
import { DateTime } from 'luxon'
import { readFile } from 'node:fs/promises'
import { mock, B, C, E } from './audit-fixture.mjs'
import { PDF_BYTES } from './document-pdf-fixture.mjs'

const pdfTitle = kind => kind === 'invoice' ? 'Invoice PDF' : 'Estimate PDF'
const sends = state => state.calls.filter(call => call.path.includes('/send-'))
async function createForm(page, kind) {
 await page.goto('/?view=' + kind + 's')
 await page.getByRole('button', { name: 'Create ' + kind, exact: true }).click()
 const form=page.getByRole('dialog', { name: 'Create an ' + kind, exact: true });if(kind==='invoice')await openInvoiceOptions(form);return form
}
async function chooseCustomer(form) {
 await form.getByRole('combobox', { name: 'Customer', exact: true }).fill('Test')
 await form.getByRole('option', { name: /Test Customer/ }).click()
}
async function readyPdf(form, kind, state) {
 const pdf = form.getByRole('region', { name: pdfTitle(kind), exact: true })
 await expect(pdf.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled()
 await expect(pdf.locator('iframe')).toHaveAttribute('src', /^blob:/)
 await expect.poll(() => state.documents.length).toBe(1)
 expect(state.calls.filter(call => call.path.endsWith('/document-pdf') && call.method === 'POST').at(-1).body)
  .toEqual({ business_id: B, document_kind: kind, document_id: E })
 return pdf
}

for (const kind of ['invoice', 'estimate']) for (const width of [390, 1280]) test(`${kind}: saved PDF at ${width}px; back edits the same draft without duplicate creation`, async ({ page }) => {
 const state = await mock(page)
 await page.setViewportSize({ width, height: 1000 })
 const form = await createForm(page, kind)
 const issued = await form.getByLabel(kind==='invoice'?'Invoice date':'Issue date', { exact: true }).inputValue()
 const dateLabel = kind === 'invoice' ? 'Due date' : 'Valid until'
 const editDateLabel = kind === 'invoice' ? 'Due date' : 'Expires on'
 if(kind==='invoice')await form.getByLabel('Payment terms',{exact:true}).selectOption('custom')
 await expect(form.getByLabel(dateLabel, { exact: true })).toHaveValue(DateTime.fromISO(issued).plus({ days: kind === 'estimate' ? 30 : 0 }).toISODate())
 await chooseCustomer(form)
 await form.getByLabel('Line 1 description', { exact: true }).fill('Lawn maintenance')
 await form.getByLabel('Line 1 unit price', { exact: true }).fill('250')
 const ending = DateTime.fromISO(issued).plus({ days: 45 }).toISODate()
 await form.getByLabel(dateLabel, { exact: true }).fill(ending)
 await reviewDocument(form)
 const pdf = await readyPdf(form, kind, state)
 await expect(form.locator(kind==='invoice'?'.invoice-review-paper':'.creation-review-bar')).toContainText('$250.00')
 expect(state.documents[0].payload).toMatchObject({ customer_id: C, [kind === 'invoice' ? 'due_date' : 'expires_on']: ending,
  items: [{ description: 'Lawn maintenance', quantity: 1, unit_price: 250, tax_rate: 0 }] })
 const bounds = await pdf.boundingBox()
 expect(bounds).not.toBeNull()
 expect(bounds.x).toBeGreaterThanOrEqual(0)
 expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
 if(kind==='invoice')await expect(form.getByRole('button',{name:'Send Finviant SMS',exact:true})).toHaveCount(0);else await expect(form.getByRole('button', { name: 'Send Text', exact: true })).toBeDisabled()
 await expect(form.getByRole('button', { name:/^(Open saved draft|Close invoice review)$/,exact:true })).toBeEnabled()
 const downloaded = page.waitForEvent('download')
 await pdf.getByRole('button', { name: 'Download PDF', exact: true }).click()
 const download = await downloaded
 expect(download.suggestedFilename()).toBe('Saved document.pdf')
 expect(await readFile(await download.path())).toEqual(PDF_BYTES)
 expect(sends(state)).toHaveLength(0)

 await form.getByRole('button', { name: '← Back to edit', exact: true }).click()
 const editor = page.getByRole('dialog', { name: 'Edit draft ' + kind, exact: true })
 await expect(editor.getByLabel('Line 1 description', { exact: true })).toHaveValue('Lawn maintenance')
 await expect(editor.getByLabel(editDateLabel, { exact: true })).toHaveValue(ending)
 await editor.getByLabel('Line 1 description', { exact: true }).fill('Lawn maintenance and edging')
 await editor.getByRole('button', { name: 'Save draft changes', exact: true }).click()
 await expect(editor).toHaveCount(0)
 expect(state.documents).toHaveLength(1)
 expect(state.documentUpdates).toHaveLength(1)
 expect(state.documentUpdates[0]).toMatchObject({ target_business_id: B, document_kind: kind, document_id: E,
  payload: { [kind === 'invoice' ? 'due_date' : 'expires_on']: ending, items: [{ description: 'Lawn maintenance and edging', unit_price: 250 }] } })
 await page.getByRole('button', { name: 'Edit draft', exact: true }).click()
 await expect(editor.getByLabel('Line 1 description', { exact: true })).toHaveValue('Lawn maintenance and edging')
 await expect(editor.getByLabel(editDateLabel, { exact: true })).toHaveValue(ending)
 expect(sends(state)).toHaveLength(0)
})

for (const kind of ['invoice', 'estimate']) test(`${kind}: entry fields are visible and inherited tax exceptions survive PDF publication and editing`, async ({ page }) => {
 const state = await mock(page, { defaultTax: 5 })
 await page.setViewportSize({ width: 390, height: 844 })
 const form = await createForm(page, kind)
 await expect(form.getByRole('combobox', { name: 'Customer', exact: true })).toBeVisible()
 await expect(form.getByLabel('Line 1 description', { exact: true })).toBeVisible()
 await expect(form.getByLabel('Line 1 Tax rate (%)', { exact: true })).toBeHidden()
 if(kind==='invoice'){await expect(form.getByLabel('Line 1 unit price',{exact:true})).toBeVisible();await expect(form.getByLabel('Line 1 quantity',{exact:true})).toBeHidden()}else expect(await form.locator('.line-item').first().locator('input').evaluateAll(inputs => inputs.map(input => input.placeholder))).toEqual(['Description', 'Unit price', 'Qty'])
 await chooseCustomer(form)
 await form.getByLabel('Line 1 description', { exact: true }).fill('Tax-exempt labor')
 await form.getByLabel('Line 1 unit price', { exact: true }).fill('100')
 await expect(form.getByLabel('Line 1 quantity', { exact: true })).toHaveValue('1')
 await form.getByText(kind==='invoice'?'Per-item tax rates':'Tax options · 5% default', { exact: true }).click()
 await form.getByLabel('Line 1 Tax rate (%)', { exact: true }).fill('0')
 await addDocumentItem(form)
 await form.getByLabel('Line 2 description', { exact: true }).fill('Taxable supplies')
 await form.getByLabel('Line 2 unit price', { exact: true }).fill('100')
 await expect(form.getByLabel('Line 2 Tax rate (%)', { exact: true })).toHaveValue('5')
 await reviewDocument(form)
 await readyPdf(form, kind, state)
 await expect(form.locator(kind==='invoice'?'.invoice-review-paper':'.creation-review-bar')).toContainText('$205.00')
 expect(state.documents[0].payload.items.map(item => item.tax_rate)).toEqual([0, 5])
 await form.getByRole('button', { name: '← Back to edit', exact: true }).click()
 const editor = page.getByRole('dialog', { name: 'Edit draft ' + kind, exact: true })
 await expect(editor.getByLabel('Line 1 description', { exact: true })).toHaveValue('Tax-exempt labor')
 await expect(editor.getByLabel('Line 1 Tax rate (%)', { exact: true })).toHaveValue('0')
 await expect(editor.getByLabel('Line 2 Tax rate (%)', { exact: true })).toHaveValue('5')
 await expect(editor).toContainText('Preview total: $205.00')
 await editor.getByRole('button', { name: 'Save draft changes', exact: true }).click()
 await expect(editor).toHaveCount(0)
 expect(state.documents).toHaveLength(1)
 expect(state.documentUpdates[0].payload.items.map(item => item.tax_rate)).toEqual([0, 5])
 expect(sends(state)).toHaveLength(0)
})

for (const kind of ['invoice', 'estimate']) test(`${kind}: opening the published draft does not save or send again`, async ({ page }) => {
 const state = await mock(page)
 const form = await createForm(page, kind)
 await chooseCustomer(form)
 await form.getByLabel('Line 1 description', { exact: true }).fill('Maintenance')
 await form.getByLabel('Line 1 unit price', { exact: true }).fill('100')
 await reviewDocument(form)
 await readyPdf(form, kind, state)
 await form.getByRole('button', { name:/^(Open saved draft|Close invoice review)$/,exact:true }).click()
 await expect(form).toHaveCount(0)
 await expect(page.getByRole('button', { name: 'Edit draft', exact: true })).toBeVisible()
 expect(state.documents).toHaveLength(1)
 expect(state.documentUpdates).toHaveLength(0)
 expect(sends(state)).toHaveLength(0)
})
