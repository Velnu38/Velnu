import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, PDFName } from 'pdf-lib'
import { generateDocumentPdf } from '../../shared/documentPdf.ts'
import { documentPdfFixture } from './pdf-fixtures.ts'

async function extracted(bytes: Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'finviant-document-pdf-'))
  try {
    const file = join(directory, 'document.pdf')
    await writeFile(file, bytes)
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
  } finally { await rm(directory, { recursive: true, force: true }) }
}

test('invoice PDF preserves selectable branding, customer, address, tax, deposits and exact due amount', async () => {
  const bytes = await generateDocumentPdf(documentPdfFixture())
  const content = await extracted(bytes)
  for (const value of ['Harbor & Field Services LLC', 'José Álvarez', 'Álvarez Family Properties', '84 Waterside Drive', 'Rear entrance', 'INV-1042', 'Tax 8%', '$375.00', '$30.00', '-$100.00', '$305.00', '-$50.00', '$255.00', 'Payment is due within 14 days.', 'one year.', 'Created with Finviant Office Assistant']) assert.ok(content.includes(value), `PDF includes ${value}`)
  const pdf = await PDFDocument.load(bytes)
  assert.equal(pdf.getPageCount(), 1)
  assert.equal(pdf.getPages()[0].node.Annots()?.size() || 0, 0, 'Payment actions stay outside the immutable PDF')
  assert.doesNotMatch(content, /payments\.example\.test/, 'A frozen amount-prefilled provider URL is not printed')
})

test('identical frozen revisions produce identical bytes and do not mutate the snapshot', async () => {
  const snapshot = documentPdfFixture()
  const previous = JSON.stringify(snapshot)
  const first = await generateDocumentPdf(snapshot)
  const second = await generateDocumentPdf(snapshot)
  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(snapshot), previous)
  const pdf = await PDFDocument.load(first, { updateMetadata: false })
  assert.equal(pdf.getCreationDate()?.toISOString(), '2026-11-08T12:00:00.000Z')
  assert.equal(pdf.getModificationDate()?.toISOString(), '2026-11-08T12:00:00.000Z')
})

test('estimates retain their validity and customer terms without invoice payment instructions', async () => {
  const snapshot = documentPdfFixture('estimate')
  snapshot.total = 405
  const content = await extracted(await generateDocumentPdf(snapshot))
  assert.match(content, /ESTIMATE/)
  assert.match(content, /Dec 8, 2026/)
  assert.match(content, /Estimated total/)
  assert.match(content, /\$405\.00/)
  assert.match(content, /Please approve before we schedule/)
  assert.doesNotMatch(content, /Deposit credited|Amount due|Payment is due within 14 days/)
})

test('change orders retain scope, reason, schedule and revised financial totals', async () => {
  const content = await extracted(await generateDocumentPdf(documentPdfFixture('change_order')))
  for (const value of ['CHANGE ORDER', 'Replace corroded shutoff valves', 'cannot be reused safely', '+1 days', 'next business day', 'Current total', '$405.00', '+$125.00', 'Revised total', '$530.00', 'Deposit paid', 'Other payments recorded', 'Remaining if approved', '$380.00']) assert.ok(content.includes(value), `PDF includes ${value}`)
})

test('one long multiline line item spans pages without dropping text or repeating its amounts', async () => {
  const snapshot = documentPdfFixture()
  const lines = Array.from({ length: 180 }, (_, index) => `Scope checkpoint ${String(index + 1).padStart(3, '0')}: inspect, complete and document this specific work.`)
  snapshot.items = [{ description: lines.join('\n'), quantity: 1, unit_price: 375, line_total: 375, tax_rate: 8 }]
  const bytes = await generateDocumentPdf(snapshot)
  const pdf = await PDFDocument.load(bytes)
  assert.ok(pdf.getPageCount() >= 4)
  const content = await extracted(bytes)
  for (let index = 1; index <= 180; index++) assert.match(content, new RegExp(`Scope checkpoint ${String(index).padStart(3, '0')}:`))
  assert.equal((content.match(/DESCRIPTION/g) || []).length, pdf.getPageCount(), 'Each table continuation repeats its column headings')
  assert.match(content, new RegExp(`Page ${pdf.getPageCount()} of ${pdf.getPageCount()}`))
  assert.equal((content.match(/Amount due/g) || []).length, 1)
})

test('paid branding stays absent and unsupported glyphs fail instead of corrupting customer text', async () => {
  const snapshot = documentPdfFixture()
  snapshot.finviant_branding = false
  assert.doesNotMatch(await extracted(await generateDocumentPdf(snapshot)), /Created with Finviant/)
  snapshot.customer.name = 'Customer \u{20000}'
  await assert.rejects(generateDocumentPdf(snapshot), /cannot display U\+20000/)
})

test('a saved logo must load successfully and valid PNG bytes are embedded', async () => {
  const snapshot = documentPdfFixture()
  snapshot.company.logo_path = 'business-id/immutable-logo.png'
  await assert.rejects(generateDocumentPdf(snapshot), /saved company logo could not be loaded/)
  const logo = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'))
  const bytes = await generateDocumentPdf(snapshot, { logo: { bytes: logo, mimeType: 'image/png' } })
  const pdf = await PDFDocument.load(bytes)
  const resources = pdf.getPages()[0].node.Resources()
  assert.ok(resources?.has(PDFName.of('XObject')), 'The company logo is embedded in the PDF')
})

test('invalid finances cannot be printed as an apparently valid customer document', async () => {
  const snapshot = documentPdfFixture()
  snapshot.total = 'not-an-amount'
  await assert.rejects(generateDocumentPdf(snapshot), /invalid amount/)
})

for (const kind of ['invoice', 'estimate'] as const) {
  test(`${kind} uses a centered bottom Thank You! only when custom footer is blank`, async () => {
    const snapshot = documentPdfFixture(kind)
    for (const footer of [null, '', '   ']) {
      snapshot.company.document_footer = footer
      const bytes = await generateDocumentPdf(snapshot)
      const content = await extracted(bytes)
      assert.equal((content.match(/Thank You!/g) || []).length, 1)
      const directory = await mkdtemp(join(tmpdir(), 'finviant-footer-'))
      try {
        const file = join(directory, 'document.pdf')
        await writeFile(file, bytes)
        const bbox = execFileSync('pdftotext', ['-bbox', file, '-'], { encoding: 'utf8' })
        const words = [...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(Thank|You!)<\/word>/g)]
        assert.equal(words.length, 2)
        assert.ok(Math.abs((Number(words[0][1]) + Number(words[1][3])) / 2 - 306) < 1, 'Footer is centered on the Letter page')
        assert.ok(Number(words[0][2]) > 700, 'Footer is at the bottom of the page')
      } finally { await rm(directory, { recursive: true, force: true }) }
      assert.equal(snapshot.company.document_footer, footer, 'Rendering never writes the fallback into saved data')
    }
    snapshot.company.document_footer = 'Custom warranty terms.\nPlease retain this document.'
    const custom = await extracted(await generateDocumentPdf(snapshot))
    assert.match(custom, /Custom warranty terms/)
    assert.match(custom, /Please retain this document/)
    assert.doesNotMatch(custom, /Thank You!|NOTES/)
  })
}

test('long custom closing footnotes paginate without losing wording', async () => {
  const snapshot = documentPdfFixture()
  snapshot.company.document_footer = Array.from({ length: 80 }, (_, i) => `Custom footer condition ${String(i).padStart(3, '0')}`).join('\n')
  const content = await extracted(await generateDocumentPdf(snapshot))
  for (let i = 0; i < 80; i++) assert.match(content, new RegExp(`Custom footer condition ${String(i).padStart(3, '0')}`))
  assert.doesNotMatch(content, /Thank You!/)
})
