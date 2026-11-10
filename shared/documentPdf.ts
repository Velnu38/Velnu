import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, type RGB } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { documentFooter } from './documentAppearance.ts'
import { documentPdfFonts } from './fonts/dejavuSans.ts'

export const DOCUMENT_PDF_TEMPLATE_VERSION = 'finviant-document-3'
export type DocumentPdfAmount = number | string
export type DocumentPdfParty = {
  name?: string | null; first_name?: string | null; last_name?: string | null
  company?: string | null; legal_name?: string | null; email?: string | null
  phone?: string | null; website?: string | null; logo_path?: string | null
  document_accent?: string | null; document_footer?: string | null
  address_line1?: string | null; address_line2?: string | null
  city?: string | null; state?: string | null; postal_code?: string | null
  country?: string | null
}
export type DocumentPdfLine = {
  id?: string; description: string; quantity: DocumentPdfAmount
  unit_price: DocumentPdfAmount; tax_rate?: DocumentPdfAmount | null
  line_total: DocumentPdfAmount; sort_order?: number
}
export type DocumentPdfChangeTotals = {
  current_total: DocumentPdfAmount; change_amount: DocumentPdfAmount
  revised_total: DocumentPdfAmount; deposit_paid?: DocumentPdfAmount | null
  other_paid?: DocumentPdfAmount | null; revision_subtotal?: DocumentPdfAmount | null
  revision_tax?: DocumentPdfAmount | null; manual_billing?: boolean
}
type ChangeOrderFields = {
  title?: string | null; description?: string | null; reason?: string | null
  schedule_impact_days?: number | null; schedule_note?: string | null
}
export type CanonicalDocumentSnapshot = ChangeOrderFields & {
  schema_version?: number; document_id?: string; revision_id?: string
  revision_number?: number; revision_created_at?: string; created_at?: string
  kind: 'invoice' | 'estimate' | 'change_order'; number?: string | null
  status?: string | null; issue_date: string; due_date?: string | null
  expires_on?: string | null; currency?: string | null
  subtotal: DocumentPdfAmount; tax_amount: DocumentPdfAmount; total: DocumentPdfAmount
  deposit_credit?: DocumentPdfAmount | null; amount_paid?: DocumentPdfAmount | null
  balance_due?: DocumentPdfAmount | null; customer_message?: string | null; customer_reference?: string | null
  payment_instructions?: string | null; payment_links?: { provider: string; url: string }[]
  customer: DocumentPdfParty; company: DocumentPdfParty
  service_address?: string | null; service_location?: DocumentPdfParty | null
  items: DocumentPdfLine[]; finviant_branding?: boolean
  change_totals?: DocumentPdfChangeTotals | null
  change_order?: ChangeOrderFields | null
}
export type DocumentPdfOptions = {
  logo?: { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' }
  regularFontBytes?: Uint8Array; boldFontBytes?: Uint8Array
}

const PAGE_WIDTH = 612, PAGE_HEIGHT = 792, MARGIN = 44
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2, BOTTOM = 64
const ink = rgb(0.059, 0.153, 0.278), textColor = rgb(0.13, 0.18, 0.24)
const muted = rgb(0.36, 0.42, 0.49), lineColor = rgb(0.83, 0.87, 0.91)
const pale = rgb(0.95, 0.97, 0.98), white = rgb(1, 1, 1)

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : ''
}
function amount(value: DocumentPdfAmount | null | undefined, fallback = 0): number {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || Math.abs(parsed) > 1_000_000_000_000) throw new Error('The document contains an invalid amount. Review the saved revision before sending.')
  return parsed
}
function documentDate(value: string | null | undefined): string {
  const raw = text(value)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) return raw
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[Number(match[2]) - 1] || match[2]} ${Number(match[3])}, ${match[1]}`
}
function partyName(party: DocumentPdfParty): string {
  return text(party.name) || [text(party.first_name), text(party.last_name)].filter(Boolean).join(' ') || text(party.company)
}
function addressLines(party: DocumentPdfParty): string[] {
  return [text(party.address_line1), text(party.address_line2), [text(party.city), text(party.state), text(party.postal_code)].filter(Boolean).join(' '), text(party.country)].filter(Boolean)
}
function accentColor(value: string | null | undefined): RGB {
  const color = /^#([0-9a-f]{6})$/i.exec(value || '')?.[1]
  return color ? rgb(parseInt(color.slice(0, 2), 16) / 255, parseInt(color.slice(2, 4), 16) / 255, parseInt(color.slice(4, 6), 16) / 255) : rgb(0.08, 0.60, 0.56)
}

/**
 * Render one frozen document revision. There is deliberately no network, clock,
 * browser state, or database access here. Store the returned bytes once and use
 * that same PDF for final review, customer download and email attachment.
 */
export async function generateDocumentPdf(snapshot: CanonicalDocumentSnapshot, options: DocumentPdfOptions = {}): Promise<Uint8Array> {
  if (!snapshot || !['invoice', 'estimate', 'change_order'].includes(snapshot.kind) || !Array.isArray(snapshot.items) || !snapshot.items.length || !snapshot.company || !snapshot.customer) {
    throw new Error('A complete saved document revision is required to create its PDF.')
  }
  if (snapshot.schema_version != null && snapshot.schema_version !== 1) throw new Error('This document revision needs a newer PDF renderer.')
  if (snapshot.items.length > 2000) throw new Error('The document has too many line items to render safely.')
  if (text(snapshot.company.logo_path) && !options.logo) throw new Error('The saved company logo could not be loaded. Retry before sending the document.')
  if (options.logo && (!options.logo.bytes.length || options.logo.bytes.length > 2_000_000)) throw new Error('The document logo must be a PNG or JPEG smaller than 2 MB.')
  const pdf = await PDFDocument.create({ updateMetadata: false })
  pdf.registerFontkit(fontkit)
  const fonts = documentPdfFonts()
  const regular = await pdf.embedFont(options.regularFontBytes || fonts.regular, { subset: true })
  const bold = await pdf.embedFont(options.boldFontBytes || fonts.bold, { subset: true })
  const supported = new Map<PDFFont, Set<number>>([[regular, new Set(regular.getCharacterSet())], [bold, new Set(bold.getCharacterSet())]])
  const label = snapshot.kind === 'invoice' ? 'Invoice' : snapshot.kind === 'estimate' ? 'Estimate' : 'Change order'
  const number = text(snapshot.number) || 'Draft'
  const business = partyName(snapshot.company) || 'Business'
  const currency = text(snapshot.currency) || 'USD'
  let formatter: Intl.NumberFormat
  try { formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency }) }
  catch { throw new Error('The document currency is invalid. Review the saved revision before sending.') }
  const money = (value: DocumentPdfAmount | null | undefined, fallback = 0) => formatter.format(amount(value, fallback))
  const suppliedTimestamp = snapshot.revision_created_at || snapshot.created_at || ''
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(suppliedTimestamp) ? suppliedTimestamp : `${snapshot.issue_date}T00:00:00.000Z`
  const parsedTimestamp = new Date(timestamp)
  const creationDate = Number.isFinite(parsedTimestamp.getTime()) ? parsedTimestamp : new Date('2000-01-01T00:00:00.000Z')
  pdf.setCreationDate(creationDate); pdf.setModificationDate(creationDate)
  pdf.setProducer(DOCUMENT_PDF_TEMPLATE_VERSION); pdf.setCreator('Finviant Office')
  pdf.setTitle(`${label} ${number}`); pdf.setAuthor(business)
  pdf.setSubject(`Saved document revision ${snapshot.revision_number || 1}`)
  let logo: PDFImage | null = null
  if (options.logo) {
    try { logo = options.logo.mimeType === 'image/png' ? await pdf.embedPng(options.logo.bytes) : await pdf.embedJpg(options.logo.bytes) }
    catch { throw new Error('The saved company logo is not a supported PNG or JPEG. Review it before sending.') }
  }
  const accent = accentColor(snapshot.company.document_accent)
  // A light brand tint stays readable even with very pale customer accent colors.
  const brandTint = rgb(0.94 + accent.red * 0.06, 0.94 + accent.green * 0.06, 0.94 + accent.blue * 0.06)
  const pages: PDFPage[] = []
  let page!: PDFPage
  let y = 0
  function encoded(value: string, font: PDFFont): string {
    for (const character of value) {
      const point = character.codePointAt(0)!
      if (character !== '\n' && !supported.get(font)!.has(point)) throw new Error(`The document font cannot display U+${point.toString(16).toUpperCase()}. Choose a supported document font before sending.`)
    }
    return value
  }
  function width(value: string, size: number, font = regular): number { return font.widthOfTextAtSize(encoded(value, font), size) }
  function draw(value: string, x: number, top: number, size = 10, font = regular, color = textColor) {
    page.drawText(encoded(value, font), { x, y: top - size, size, font, color })
  }
  function right(value: string, edge: number, top: number, size = 10, font = regular, color = textColor, maxWidth = 110) {
    let fittedSize = size
    while (width(value, fittedSize, font) > maxWidth && fittedSize > 6) fittedSize -= 0.25
    if (width(value, fittedSize, font) > maxWidth) throw new Error('A document number or amount is too long to fit. Review the saved revision.')
    draw(value, edge - width(value, fittedSize, font), top, fittedSize, font, color)
  }
  function wrap(value: string, maxWidth: number, size = 10, font = regular): string[] {
    if (maxWidth <= 0) throw new Error('Invalid document layout width.')
    const result: string[] = []
    for (const paragraph of text(value).split('\n')) {
      if (!paragraph) { result.push(''); continue }
      let current = ''
      for (const word of paragraph.split(/\s+/)) {
        if (width(current ? `${current} ${word}` : word, size, font) <= maxWidth) { current = current ? `${current} ${word}` : word; continue }
        if (current) { result.push(current); current = '' }
        let piece = ''
        for (const character of word) {
          if (piece && width(piece + character, size, font) > maxWidth) { result.push(piece); piece = '' }
          piece += character
        }
        current = piece
      }
      if (current) result.push(current)
    }
    return result.length ? result : ['']
  }
  function newPage(continued = false) {
    if (pages.length >= 100) throw new Error('The document exceeds the 100-page PDF limit.')
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]); pages.push(page)
    page.drawRectangle({ x: MARGIN, y: PAGE_HEIGHT - MARGIN - 4, width: CONTENT_WIDTH, height: 4, color: accent })
    y = PAGE_HEIGHT - MARGIN - 20
    if (continued) {
      const heading = wrap(business, 300, 10, bold)[0]
      draw(heading, MARGIN, y, 10, bold, ink)
      right(`${label} ${number}`, PAGE_WIDTH - MARGIN, y, 10, bold, ink, 210)
      y -= 24
    }
  }
  function ensure(height: number) { if (y - height < BOTTOM) newPage(true) }
  function paragraph(value: string, size = 10, font = regular, color = textColor, gap = 13, maxWidth = CONTENT_WIDTH) {
    for (const line of wrap(value, maxWidth, size, font)) { ensure(gap); if (line) draw(line, MARGIN, y, size, font, color); y -= gap }
  }
  function section(title: string, value: string, maxWidth = CONTENT_WIDTH) {
    if (!text(value)) return
    const compact = maxWidth < CONTENT_WIDTH
    ensure(compact ? 34 : 42); y -= compact ? 8 : 14; draw(title.toUpperCase(), MARGIN, y, 8, bold, muted); y -= compact ? 14 : 17
    paragraph(value, compact ? 9 : 10, regular, textColor, compact ? 12 : 13, maxWidth)
  }
  newPage()
  const identityX = MARGIN + (logo ? 76 : 0)
  const identityWidth = 330 - (logo ? 76 : 0)
  const identityPage = page
  let identityY = y
  if (logo) {
    const dimensions = logo.scaleToFit(62, 60)
    page.drawImage(logo, { x: MARGIN, y: identityY - dimensions.height, width: dimensions.width, height: dimensions.height })
  }
  right(label.toUpperCase(), PAGE_WIDTH - MARGIN, identityY, snapshot.kind === 'change_order' ? 17 : 21, bold, ink, 178)
  let contactY = y - 30
  for (const detail of [text(snapshot.company.email), text(snapshot.company.phone), text(snapshot.company.website)].filter(Boolean)) {
    for (const line of wrap(detail, 178, 8)) {
      if (contactY - 12 < BOTTOM + 20) throw new Error('The company contact details are too long to fit. Review the saved revision.')
      right(line, PAGE_WIDTH - MARGIN, contactY, 8, regular, muted, 178); contactY -= 12
    }
  }
  for (const line of wrap(business, identityWidth, 15, bold)) {
    if (identityY - 19 < BOTTOM + 20) { newPage(true); identityY = y }
    draw(line, identityX, identityY, 15, bold, ink); identityY -= 19
  }
  const identityDetails = [
    text(snapshot.company.legal_name) && text(snapshot.company.legal_name) !== business ? text(snapshot.company.legal_name) : '',
    ...addressLines(snapshot.company),
  ].filter(Boolean)
  for (const detail of identityDetails) for (const line of wrap(detail, identityWidth, 9)) {
    if (identityY - 12 < BOTTOM + 20) { newPage(true); identityY = y }
    draw(line, identityX, identityY, 9, regular, muted); identityY -= 12
  }
  y = (page === identityPage ? Math.min(identityY, contactY, y - (logo ? 64 : 26)) : identityY) - 18
  ensure(68)
  page.drawRectangle({ x: MARGIN, y: y - 51, width: CONTENT_WIDTH, height: 51, color: brandTint })
  const metadata = [[`${label} number`, number], ['Issued', documentDate(snapshot.issue_date)], snapshot.kind === 'change_order' ? ['Revision', String(snapshot.revision_number || 1)] : [snapshot.kind === 'invoice' ? 'Due date' : 'Valid until', documentDate(snapshot.kind === 'invoice' ? snapshot.due_date : snapshot.expires_on) || 'Not specified']]
  metadata.forEach(([caption, value], index) => {
    const x = MARGIN + 12 + index * (CONTENT_WIDTH / 3)
    draw(caption.toUpperCase(), x, y - 10, 7, bold, muted)
    const lines = wrap(value, CONTENT_WIDTH / 3 - 24, 10, bold)
    if (lines.length > 2) throw new Error('The document reference is too long to fit. Review the saved revision.')
    lines.forEach((line, lineIndex) => draw(line, x, y - 24 - lineIndex * 12, 10, bold, ink))
  })
  y -= 72
  if(text(snapshot.customer_reference)){
    const referenceLines=wrap('Customer PO / reference: '+text(snapshot.customer_reference),CONTENT_WIDTH,9)
    for(const line of referenceLines){ensure(14);draw(line,MARGIN,y,9,regular,ink);y-=13}
    y-=10
  }
  const customerName = partyName(snapshot.customer) || 'Customer'
  const customerDetails = [customerName, text(snapshot.customer.company) && text(snapshot.customer.company) !== customerName ? text(snapshot.customer.company) : '', ...addressLines(snapshot.customer), text(snapshot.customer.email), text(snapshot.customer.phone)].filter(Boolean)
  const service = text(snapshot.service_address) || (snapshot.service_location ? addressLines(snapshot.service_location).join('\n') : '')
  const leftLines = customerDetails.flatMap((value, index) => wrap(value, 246, index === 0 ? 11 : 9, index === 0 ? bold : regular))
  const rightLines = service ? wrap(service, 246, 9) : []
  function addressHeader() {
    ensure(44)
    draw(snapshot.kind === 'invoice' ? 'BILL TO' : 'PREPARED FOR', MARGIN, y, 8, bold, muted)
    if (service) draw('SERVICE ADDRESS', 322, y, 8, bold, muted)
    y -= 18
  }
  addressHeader()
  for (let index = 0; index < Math.max(leftLines.length, rightLines.length); index++) {
    if (y - 13 < BOTTOM) { newPage(true); addressHeader() }
    if (leftLines[index]) draw(leftLines[index], MARGIN, y, index === 0 ? 11 : 9, index === 0 ? bold : regular)
    if (rightLines[index]) draw(rightLines[index], 322, y, 9, regular)
    y -= 13
  }
  y -= 17
  const change = { ...snapshot.change_order, title: snapshot.title ?? snapshot.change_order?.title, description: snapshot.description ?? snapshot.change_order?.description, reason: snapshot.reason ?? snapshot.change_order?.reason, schedule_impact_days: snapshot.schedule_impact_days ?? snapshot.change_order?.schedule_impact_days, schedule_note: snapshot.schedule_note ?? snapshot.change_order?.schedule_note }
  if (snapshot.kind === 'change_order') {
    if (text(change.title)) { ensure(24); paragraph(text(change.title), 13, bold, ink, 17); y -= 5 }
    section('Scope of change', text(change.description))
    section('Reason for change', text(change.reason))
    if (change.schedule_impact_days || text(change.schedule_note)) section('Schedule impact', [change.schedule_impact_days ? `${change.schedule_impact_days > 0 ? '+' : ''}${change.schedule_impact_days} days` : '', text(change.schedule_note)].filter(Boolean).join('\n'))
    y -= 14
  }
  function tableHeader() {
    ensure(40)
    page.drawRectangle({ x: MARGIN, y: y - 25, width: CONTENT_WIDTH, height: 25, color: ink })
    draw('DESCRIPTION', 56, y - 8, 8, bold, white)
    right('QTY', 386, y - 8, 8, bold, white, 40)
    right('RATE', 468, y - 8, 8, bold, white, 70)
    right('AMOUNT', 556, y - 8, 8, bold, white, 80)
    y -= 25
  }
  tableHeader()
  for (let index = 0; index < snapshot.items.length; index++) {
    const item = snapshot.items[index]
    const revisionSubtotal = index === 0 && snapshot.kind === 'change_order' ? snapshot.change_totals?.revision_subtotal : null
    const itemQuantity = revisionSubtotal != null ? 1 : amount(item.quantity)
    const itemRate = revisionSubtotal != null ? revisionSubtotal : item.unit_price
    const itemTotal = revisionSubtotal != null ? revisionSubtotal : item.line_total
    const description = wrap(text(item.description), 280, 9.5)
    if (amount(snapshot.tax_amount) !== 0 && amount(item.tax_rate) !== 0) description.push(`Tax ${amount(item.tax_rate)}%`)
    let consumed = 0
    while (consumed < description.length) {
      if (y - 34 < BOTTOM) { newPage(true); tableHeader() }
      const availableLines = Math.max(1, Math.floor((y - BOTTOM - 17) / 13))
      const lines = description.slice(consumed, consumed + availableLines)
      const rowHeight = Math.max(34, lines.length * 13 + 17)
      if (index % 2 === 0) page.drawRectangle({ x: MARGIN, y: y - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: pale })
      lines.forEach((line, lineIndex) => { if (line) draw(line, 56, y - 9 - lineIndex * 13, 9.5) })
      if (consumed === 0) {
        right(String(itemQuantity), 386, y - 9, 9.5, regular, textColor, 42)
        right(money(itemRate), 468, y - 9, 9.5, regular, textColor, 74)
        right(money(itemTotal), 556, y - 9, 9.5, bold, ink, 80)
      }
      page.drawLine({ start: { x: MARGIN, y: y - rowHeight }, end: { x: PAGE_WIDTH - MARGIN, y: y - rowHeight }, thickness: 0.5, color: lineColor })
      y -= rowHeight; consumed += lines.length
      if (consumed < description.length) { newPage(true); tableHeader() }
    }
  }
  y -= 20
  const totals: { label: string; value: string; grand?: boolean }[] = []
  if (snapshot.kind === 'change_order' && snapshot.change_totals) {
    const amounts = snapshot.change_totals
    const delta = amount(amounts.change_amount)
    totals.push({ label: 'Current total', value: money(amounts.current_total) }, { label: 'This change', value: `${delta > 0 ? '+' : ''}${money(amounts.change_amount)}` }, { label: 'Revised total', value: money(amounts.revised_total), grand: true })
    if (amount(amounts.deposit_paid) > 0) totals.push({ label: 'Deposit paid', value: money(amounts.deposit_paid) })
    if (amount(amounts.other_paid) > 0) totals.push({ label: 'Other payments recorded', value: money(amounts.other_paid) })
    const paid = amount(amounts.deposit_paid) + amount(amounts.other_paid)
    if (paid > 0) { const remaining = amount(amounts.revised_total) - paid; totals.push({ label: remaining < 0 ? 'Credit or refund to review' : 'Remaining if approved', value: money(Math.abs(remaining)) }) }
  } else {
    totals.push({ label: 'Subtotal', value: money(snapshot.subtotal) })
    if (amount(snapshot.tax_amount) !== 0) totals.push({ label: 'Tax', value: money(snapshot.tax_amount) })
    if (snapshot.kind === 'invoice' && amount(snapshot.deposit_credit) > 0) totals.push({ label: 'Deposit credited', value: `-${money(snapshot.deposit_credit)}` })
    if (snapshot.kind === 'invoice') {
      totals.push({ label: 'Invoice total', value: money(snapshot.total) })
      if (amount(snapshot.amount_paid) > 0) totals.push({ label: 'Payments recorded', value: `-${money(snapshot.amount_paid)}` })
      totals.push({ label: 'Amount due', value: money(snapshot.balance_due, amount(snapshot.total)), grand: true })
    } else totals.push({ label: snapshot.kind === 'estimate' ? 'Estimated total' : 'Proposed change total', value: money(snapshot.total), grand: true })
  }
  ensure(totals.length * 26 + 8)
  const summaryPage = page
  const summaryTop = y
  for (const total of totals) {
    if (total.grand) {
      page.drawRectangle({ x: 302, y: y - 25, width: 266, height: 28, color: ink })
      page.drawRectangle({ x: 302, y: y - 25, width: 3, height: 28, color: accent })
    }
    draw(total.label, 312, y - 5, total.grand ? 10 : 9, total.grand ? bold : regular, total.grand ? white : muted)
    right(total.value, 556, y - 5, total.grand ? 12 : 10, bold, total.grand ? white : ink, 107)
    y -= 26
  }
  const totalsBottom = y
  y = summaryTop
  section(snapshot.kind === 'estimate' ? 'Estimate terms' : 'Message to customer', text(snapshot.customer_message), 242)
  if (snapshot.kind === 'invoice') {
    section('Payment instructions', text(snapshot.payment_instructions), 242)
    // Balance-sensitive payment actions belong to the live customer page.
    // A frozen PDF must not retain a stale, amount-prefilled provider URL.
  }
  if (page === summaryPage) y = Math.min(y, totalsBottom)
  // Keep custom wording intact, but place it as an actual centered closing footnote.
  // Long custom footers flow safely rather than colliding with totals or pagination.
  if (snapshot.kind === 'change_order') section('Notes', text(snapshot.company.document_footer))
  const footer = snapshot.kind === 'change_order' ? '' : text(documentFooter(snapshot.company.document_footer))
  if (footer) {
    const footerLines = wrap(footer, CONTENT_WIDTH - 48, 9)
    const maximumLines = Math.floor((PAGE_HEIGHT - MARGIN - 64 - BOTTOM - 24) / 13)
    for (let offset = 0; offset < footerLines.length; offset += maximumLines) {
      const lines = footerLines.slice(offset, offset + maximumLines)
      const height = lines.length * 13 + 24
      ensure(height)
      const top = BOTTOM + lines.length * 13
      page.drawLine({ start: { x: MARGIN, y: top + 12 }, end: { x: PAGE_WIDTH - MARGIN, y: top + 12 }, thickness: 0.5, color: lineColor })
      lines.forEach((line, index) => draw(line, (PAGE_WIDTH - width(line, 9)) / 2, top - index * 13, 9, regular, muted))
      if (offset + maximumLines < footerLines.length) newPage(true)
    }
  }
  for (let index = 0; index < pages.length; index++) {
    page = pages[index]
    page.drawLine({ start: { x: MARGIN, y: 46 }, end: { x: PAGE_WIDTH - MARGIN, y: 46 }, thickness: 0.5, color: lineColor })
    const reference = wrap(`${label} ${number}`, 225, 8)[0]
    draw(reference, MARGIN, 35, 8, regular, muted)
    right(`Page ${index + 1} of ${pages.length}`, PAGE_WIDTH - MARGIN, 35, 8, regular, muted, 100)
    if (snapshot.finviant_branding) draw('Created with Finviant Office Assistant', MARGIN, 22, 7, regular, muted)
  }
  return pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false })
}

export const generatePdf = generateDocumentPdf
