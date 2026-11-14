import { PDFDocument, StandardFonts } from 'pdf-lib'

// Real, parseable synthetic PDF bytes. These fixtures test the publication transport,
// download and revision gating, not the production renderer's visual output.
export const PDF_REVISION = '88888888-8888-4888-8888-888888888888'
const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Helvetica)
pdf.addPage([612, 792]).drawText('Synthetic saved document for browser workflow tests', { x: 40, y: 740, size: 14, font })
export const PDF_BYTES = Buffer.from(await pdf.save())
export const pdfHeaders = {
 'access-control-allow-origin': '*',
 'access-control-allow-headers': '*',
 'access-control-expose-headers': 'Content-Disposition, X-Finviant-Revision-Id, ETag',
 'content-type': 'application/pdf',
 'content-disposition': 'attachment; filename="Saved document.pdf"',
 'x-finviant-revision-id': PDF_REVISION,
 etag: '"synthetic-saved-document"',
}
export const fulfillPdf = route => route.fulfill({ status: 200, headers: pdfHeaders, body: PDF_BYTES })
