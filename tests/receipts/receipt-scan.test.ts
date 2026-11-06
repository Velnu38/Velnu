import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeGoogleReviewUrl } from '../../src/lib/googleReviews'
import { receiptDraft } from '../../supabase/functions/receipt-scan/receipt'
import { receiptScanHandler } from '../../supabase/functions/receipt-scan/handler'

function field(type: string, text: string, confidence = 99, currency?: string) {
  return { Type: { Text: type }, ValueDetection: { Text: text, Confidence: confidence }, Currency: currency ? { Code: currency } : undefined }
}
const receipt = {
  SummaryFields: [field('VENDOR_NAME', 'Deck Supply'), field('INVOICE_RECEIPT_DATE', '10/4/2026'),
    field('TOTAL', '$1,021.59'), field('SUBTOTAL', '$1,000.00'), field('TAX', '$21.59')],
  LineItemGroups: [{ LineItems: [{ LineItemExpenseFields: [field('ITEM', 'Deck boards')] }] }],
}
test('Textract extraction picks the total instead of the subtotal and retains detected tax and items', () => {
  assert.deepEqual(receiptDraft({ ExpenseDocuments: [receipt] }), {
    vendor: 'Deck Supply', date: '2026-10-04', total: '1021.59', tax: '21.59', items: ['Deck boards'], warning: '',
  })
})

test('ambiguous totals, invalid calendar dates, foreign currency and multi-receipt scans require review', () => {
  const uncertain = receiptDraft({ ExpenseDocuments: [{ SummaryFields: [
    field('TOTAL', '$200.00', 70), field('INVOICE_RECEIPT_DATE', '2026-02-30'),
  ] }] })
  assert.equal(uncertain.total, null)
  assert.equal(uncertain.date, null)
  const nonUsd = receiptDraft({ ExpenseDocuments: [{ SummaryFields: [field('TOTAL', '$30.00', 99, 'CAD')] }] })
  assert.equal(nonUsd.total, null)
  assert.match(nonUsd.warning, /USD/)
  assert.match(receiptDraft({ ExpenseDocuments: [receipt, receipt] }).warning, /one clear photo/)
})

const business = '11111111-1111-4111-8111-111111111111'
const requestId = '22222222-2222-4222-8222-222222222222'
const actor = '33333333-3333-4333-8333-333333333333'
const origin = 'https://finviant.com'
function request(token = 'signed', requestOrigin = origin, body = Uint8Array.of(255,216,255,217)) {
  return new Request(`https://project.supabase.co/receipt-scan?business=${business}&request=${requestId}`, {
    method: 'POST', body, headers: { origin: requestOrigin, authorization: 'Bearer ' + token, 'content-type': 'image/jpeg' },
  })
}
test('scan handler verifies the user and workspace allowance before any provider call', async () => {
  let reserved = 0, analyzed = 0
  const handler = receiptScanHandler({
    origins: [origin],
    authorize: async token => token === 'signed' ? actor : null,
    reserve: async (b, r, a) => {
      assert.deepEqual([b,r,a], [business,requestId,actor])
      reserved++
      return { error: reserved === 1 ? {code:'42501',message:'Paid plan required'} : null }
    },
    analyze: async () => { analyzed++; return { ExpenseDocuments: [receipt] } },
  })
  assert.equal((await handler(request('forged'))).status, 401)
  assert.equal((await handler(request('signed','https://external.test'))).status, 403)
  assert.equal((await handler(request('signed',origin,Uint8Array.of(0,1,2)))).status, 400)
  assert.equal(reserved, 0)
  assert.equal((await handler(request())).status, 403)
  assert.equal(analyzed, 0)
  const response = await handler(request())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await response.json()).total, '1021.59')
  assert.equal(analyzed, 1)
})

test('an unconfigured provider returns a manual-entry fallback before charging the workspace', async () => {
  const handler = receiptScanHandler({
    origins:[origin], authorize:async()=>actor, analyze:null,
    reserve:async()=>{ assert.fail('Unavailable provider should not consume allowance') },
  })
  const response=await handler(request())
  assert.equal(response.status,503)
  assert.match((await response.json()).error,/save the photo/)
})

test('Google review URL only accepts known HTTPS review links and strips tracking parameters', () => {
  assert.equal(normalizeGoogleReviewUrl('https://g.page/r/Merchant-1/review/?utm_source=share'), 'https://g.page/r/Merchant-1/review')
  assert.equal(normalizeGoogleReviewUrl('https://search.google.com/local/writereview?placeid=ChIJ123&source=test'), 'https://search.google.com/local/writereview?placeid=ChIJ123')
  for (const url of ['http://g.page/r/Merchant/review','https://g.page.example/r/Merchant/review','https://me@g.page/r/Merchant/review','https://www.google.com/redirect?next=https://example.test','javascript:alert(1)']) {
    assert.throws(() => normalizeGoogleReviewUrl(url), /review link/)
  }
})
