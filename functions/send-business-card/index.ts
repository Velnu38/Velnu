var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// shared/documentPdf.ts
var documentPdf_exports = {};
__export(documentPdf_exports, {
  DOCUMENT_PDF_TEMPLATE_VERSION: () => DOCUMENT_PDF_TEMPLATE_VERSION,
  generateDocumentPdf: () => generateDocumentPdf,
  generatePdf: () => generatePdf
});
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { documentPdfFonts } from "./font-data.ts";
function text(value) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : "";
}
function amount(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > 1e12) throw new Error("The document contains an invalid amount. Review the saved revision before sending.");
  return parsed;
}
function documentDate(value) {
  const raw = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return raw;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(match[2]) - 1] || match[2]} ${Number(match[3])}, ${match[1]}`;
}
function partyName(party) {
  return text(party.name) || [text(party.first_name), text(party.last_name)].filter(Boolean).join(" ") || text(party.company);
}
function addressLines(party) {
  return [text(party.address_line1), text(party.address_line2), [text(party.city), text(party.state), text(party.postal_code)].filter(Boolean).join(" "), text(party.country)].filter(Boolean);
}
function accentColor(value) {
  const color = /^#([0-9a-f]{6})$/i.exec(value || "")?.[1];
  return color ? rgb(parseInt(color.slice(0, 2), 16) / 255, parseInt(color.slice(2, 4), 16) / 255, parseInt(color.slice(4, 6), 16) / 255) : rgb(0.08, 0.6, 0.56);
}
async function generateDocumentPdf(snapshot, options = {}) {
  if (!snapshot || !["invoice", "estimate", "change_order"].includes(snapshot.kind) || !Array.isArray(snapshot.items) || !snapshot.items.length || !snapshot.company || !snapshot.customer) {
    throw new Error("A complete saved document revision is required to create its PDF.");
  }
  if (snapshot.schema_version != null && snapshot.schema_version !== 1) throw new Error("This document revision needs a newer PDF renderer.");
  if (snapshot.items.length > 2e3) throw new Error("The document has too many line items to render safely.");
  if (text(snapshot.company.logo_path) && !options.logo) throw new Error("The saved company logo could not be loaded. Retry before sending the document.");
  if (options.logo && (!options.logo.bytes.length || options.logo.bytes.length > 2e6)) throw new Error("The document logo must be a PNG or JPEG smaller than 2 MB.");
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const fonts = documentPdfFonts();
  const regular = await pdf.embedFont(options.regularFontBytes || fonts.regular, { subset: true });
  const bold = await pdf.embedFont(options.boldFontBytes || fonts.bold, { subset: true });
  const supported = /* @__PURE__ */ new Map([[regular, new Set(regular.getCharacterSet())], [bold, new Set(bold.getCharacterSet())]]);
  const label = snapshot.kind === "invoice" ? "Invoice" : snapshot.kind === "estimate" ? "Estimate" : "Change order";
  const number = text(snapshot.number) || "Draft";
  const business = partyName(snapshot.company) || "Business";
  const currency = text(snapshot.currency) || "USD";
  let formatter;
  try {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
  } catch {
    throw new Error("The document currency is invalid. Review the saved revision before sending.");
  }
  const money = (value, fallback = 0) => formatter.format(amount(value, fallback));
  const suppliedTimestamp = snapshot.revision_created_at || snapshot.created_at || "";
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(suppliedTimestamp) ? suppliedTimestamp : `${snapshot.issue_date}T00:00:00.000Z`;
  const parsedTimestamp = new Date(timestamp);
  const creationDate = Number.isFinite(parsedTimestamp.getTime()) ? parsedTimestamp : /* @__PURE__ */ new Date("2000-01-01T00:00:00.000Z");
  pdf.setCreationDate(creationDate);
  pdf.setModificationDate(creationDate);
  pdf.setProducer(DOCUMENT_PDF_TEMPLATE_VERSION);
  pdf.setCreator("Finviant Office");
  pdf.setTitle(`${label} ${number}`);
  pdf.setAuthor(business);
  pdf.setSubject(`Saved document revision ${snapshot.revision_number || 1}`);
  let logo = null;
  if (options.logo) {
    try {
      logo = options.logo.mimeType === "image/png" ? await pdf.embedPng(options.logo.bytes) : await pdf.embedJpg(options.logo.bytes);
    } catch {
      throw new Error("The saved company logo is not a supported PNG or JPEG. Review it before sending.");
    }
  }
  const accent = accentColor(snapshot.company.document_accent);
  const pages = [];
  let page;
  let y = 0;
  function encoded(value, font) {
    for (const character of value) {
      const point = character.codePointAt(0);
      if (character !== "\n" && !supported.get(font).has(point)) throw new Error(`The document font cannot display U+${point.toString(16).toUpperCase()}. Choose a supported document font before sending.`);
    }
    return value;
  }
  function width(value, size, font = regular) {
    return font.widthOfTextAtSize(encoded(value, font), size);
  }
  function draw(value, x, top, size = 10, font = regular, color = textColor) {
    page.drawText(encoded(value, font), { x, y: top - size, size, font, color });
  }
  function right(value, edge, top, size = 10, font = regular, color = textColor, maxWidth = 110) {
    let fittedSize = size;
    while (width(value, fittedSize, font) > maxWidth && fittedSize > 6) fittedSize -= 0.25;
    if (width(value, fittedSize, font) > maxWidth) throw new Error("A document number or amount is too long to fit. Review the saved revision.");
    draw(value, edge - width(value, fittedSize, font), top, fittedSize, font, color);
  }
  function wrap(value, maxWidth, size = 10, font = regular) {
    if (maxWidth <= 0) throw new Error("Invalid document layout width.");
    const result = [];
    for (const paragraph2 of text(value).split("\n")) {
      if (!paragraph2) {
        result.push("");
        continue;
      }
      let current = "";
      for (const word of paragraph2.split(/\s+/)) {
        if (width(current ? `${current} ${word}` : word, size, font) <= maxWidth) {
          current = current ? `${current} ${word}` : word;
          continue;
        }
        if (current) {
          result.push(current);
          current = "";
        }
        let piece = "";
        for (const character of word) {
          if (piece && width(piece + character, size, font) > maxWidth) {
            result.push(piece);
            piece = "";
          }
          piece += character;
        }
        current = piece;
      }
      if (current) result.push(current);
    }
    return result.length ? result : [""];
  }
  function newPage(continued = false) {
    if (pages.length >= 100) throw new Error("The document exceeds the 100-page PDF limit.");
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    page.drawRectangle({ x: MARGIN, y: PAGE_HEIGHT - MARGIN - 4, width: CONTENT_WIDTH, height: 4, color: accent });
    y = PAGE_HEIGHT - MARGIN - 20;
    if (continued) {
      const heading = wrap(business, 300, 10, bold)[0];
      draw(heading, MARGIN, y, 10, bold, ink);
      right(`${label} ${number}`, PAGE_WIDTH - MARGIN, y, 10, bold, ink, 210);
      y -= 24;
    }
  }
  function ensure(height) {
    if (y - height < BOTTOM) newPage(true);
  }
  function paragraph(value, size = 10, font = regular, color = textColor, gap = 13, maxWidth = CONTENT_WIDTH) {
    for (const line of wrap(value, maxWidth, size, font)) {
      ensure(gap);
      if (line) draw(line, MARGIN, y, size, font, color);
      y -= gap;
    }
  }
  function section(title, value, maxWidth = CONTENT_WIDTH) {
    if (!text(value)) return;
    const compact = maxWidth < CONTENT_WIDTH;
    ensure(compact ? 34 : 42);
    y -= compact ? 8 : 14;
    draw(title.toUpperCase(), MARGIN, y, 8, bold, muted);
    y -= compact ? 14 : 17;
    paragraph(value, compact ? 9 : 10, regular, textColor, compact ? 12 : 13, maxWidth);
  }
  newPage();
  const identityX = MARGIN + (logo ? 76 : 0);
  const identityWidth = 330 - (logo ? 76 : 0);
  const identityPage = page;
  let identityY = y;
  if (logo) {
    const dimensions = logo.scaleToFit(62, 60);
    page.drawImage(logo, { x: MARGIN, y: identityY - dimensions.height, width: dimensions.width, height: dimensions.height });
  }
  right(label.toUpperCase(), PAGE_WIDTH - MARGIN, identityY, snapshot.kind === "change_order" ? 17 : 21, bold, ink, 178);
  let contactY = y - 30;
  for (const detail of [text(snapshot.company.email), text(snapshot.company.phone), text(snapshot.company.website)].filter(Boolean)) {
    for (const line of wrap(detail, 178, 8)) {
      if (contactY - 12 < BOTTOM + 20) throw new Error("The company contact details are too long to fit. Review the saved revision.");
      right(line, PAGE_WIDTH - MARGIN, contactY, 8, regular, muted, 178);
      contactY -= 12;
    }
  }
  for (const line of wrap(business, identityWidth, 15, bold)) {
    if (identityY - 19 < BOTTOM + 20) {
      newPage(true);
      identityY = y;
    }
    draw(line, identityX, identityY, 15, bold, ink);
    identityY -= 19;
  }
  const identityDetails = [
    text(snapshot.company.legal_name) && text(snapshot.company.legal_name) !== business ? text(snapshot.company.legal_name) : "",
    ...addressLines(snapshot.company)
  ].filter(Boolean);
  for (const detail of identityDetails) for (const line of wrap(detail, identityWidth, 9)) {
    if (identityY - 12 < BOTTOM + 20) {
      newPage(true);
      identityY = y;
    }
    draw(line, identityX, identityY, 9, regular, muted);
    identityY -= 12;
  }
  y = (page === identityPage ? Math.min(identityY, contactY, y - (logo ? 64 : 26)) : identityY) - 18;
  ensure(68);
  page.drawRectangle({ x: MARGIN, y: y - 51, width: CONTENT_WIDTH, height: 51, color: pale });
  const metadata = [[`${label} number`, number], ["Issued", documentDate(snapshot.issue_date)], snapshot.kind === "change_order" ? ["Revision", String(snapshot.revision_number || 1)] : [snapshot.kind === "invoice" ? "Due date" : "Valid until", documentDate(snapshot.kind === "invoice" ? snapshot.due_date : snapshot.expires_on) || "Not specified"]];
  metadata.forEach(([caption, value], index) => {
    const x = MARGIN + 12 + index * (CONTENT_WIDTH / 3);
    draw(caption.toUpperCase(), x, y - 10, 7, bold, muted);
    const lines = wrap(value, CONTENT_WIDTH / 3 - 24, 10, bold);
    if (lines.length > 2) throw new Error("The document reference is too long to fit. Review the saved revision.");
    lines.forEach((line, lineIndex) => draw(line, x, y - 24 - lineIndex * 12, 10, bold, ink));
  });
  y -= 72;
  const customerName = partyName(snapshot.customer) || "Customer";
  const customerDetails = [customerName, text(snapshot.customer.company) && text(snapshot.customer.company) !== customerName ? text(snapshot.customer.company) : "", ...addressLines(snapshot.customer), text(snapshot.customer.email), text(snapshot.customer.phone)].filter(Boolean);
  const service = text(snapshot.service_address) || (snapshot.service_location ? addressLines(snapshot.service_location).join("\n") : "");
  const leftLines = customerDetails.flatMap((value, index) => wrap(value, 246, index === 0 ? 11 : 9, index === 0 ? bold : regular));
  const rightLines = service ? wrap(service, 246, 9) : [];
  function addressHeader() {
    ensure(44);
    draw(snapshot.kind === "invoice" ? "BILL TO" : "PREPARED FOR", MARGIN, y, 8, bold, muted);
    if (service) draw("SERVICE ADDRESS", 322, y, 8, bold, muted);
    y -= 18;
  }
  addressHeader();
  for (let index = 0; index < Math.max(leftLines.length, rightLines.length); index++) {
    if (y - 13 < BOTTOM) {
      newPage(true);
      addressHeader();
    }
    if (leftLines[index]) draw(leftLines[index], MARGIN, y, index === 0 ? 11 : 9, index === 0 ? bold : regular);
    if (rightLines[index]) draw(rightLines[index], 322, y, 9, regular);
    y -= 13;
  }
  y -= 17;
  const change = { ...snapshot.change_order, title: snapshot.title ?? snapshot.change_order?.title, description: snapshot.description ?? snapshot.change_order?.description, reason: snapshot.reason ?? snapshot.change_order?.reason, schedule_impact_days: snapshot.schedule_impact_days ?? snapshot.change_order?.schedule_impact_days, schedule_note: snapshot.schedule_note ?? snapshot.change_order?.schedule_note };
  if (snapshot.kind === "change_order") {
    if (text(change.title)) {
      ensure(24);
      paragraph(text(change.title), 13, bold, ink, 17);
      y -= 5;
    }
    section("Scope of change", text(change.description));
    section("Reason for change", text(change.reason));
    if (change.schedule_impact_days || text(change.schedule_note)) section("Schedule impact", [change.schedule_impact_days ? `${change.schedule_impact_days > 0 ? "+" : ""}${change.schedule_impact_days} days` : "", text(change.schedule_note)].filter(Boolean).join("\n"));
    y -= 14;
  }
  function tableHeader() {
    ensure(40);
    page.drawRectangle({ x: MARGIN, y: y - 25, width: CONTENT_WIDTH, height: 25, color: ink });
    draw("DESCRIPTION", 56, y - 8, 8, bold, white);
    right("QTY", 386, y - 8, 8, bold, white, 40);
    right("RATE", 468, y - 8, 8, bold, white, 70);
    right("AMOUNT", 556, y - 8, 8, bold, white, 80);
    y -= 25;
  }
  tableHeader();
  for (let index = 0; index < snapshot.items.length; index++) {
    const item = snapshot.items[index];
    const revisionSubtotal = index === 0 && snapshot.kind === "change_order" ? snapshot.change_totals?.revision_subtotal : null;
    const itemQuantity = revisionSubtotal != null ? 1 : amount(item.quantity);
    const itemRate = revisionSubtotal != null ? revisionSubtotal : item.unit_price;
    const itemTotal = revisionSubtotal != null ? revisionSubtotal : item.line_total;
    const description = wrap(text(item.description), 280, 9.5);
    if (amount(item.tax_rate) !== 0) description.push(`Tax ${amount(item.tax_rate)}%`);
    let consumed = 0;
    while (consumed < description.length) {
      if (y - 34 < BOTTOM) {
        newPage(true);
        tableHeader();
      }
      const availableLines = Math.max(1, Math.floor((y - BOTTOM - 17) / 13));
      const lines = description.slice(consumed, consumed + availableLines);
      const rowHeight = Math.max(34, lines.length * 13 + 17);
      if (index % 2 === 0) page.drawRectangle({ x: MARGIN, y: y - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: pale });
      lines.forEach((line, lineIndex) => {
        if (line) draw(line, 56, y - 9 - lineIndex * 13, 9.5);
      });
      if (consumed === 0) {
        right(String(itemQuantity), 386, y - 9, 9.5, regular, textColor, 42);
        right(money(itemRate), 468, y - 9, 9.5, regular, textColor, 74);
        right(money(itemTotal), 556, y - 9, 9.5, bold, ink, 80);
      }
      page.drawLine({ start: { x: MARGIN, y: y - rowHeight }, end: { x: PAGE_WIDTH - MARGIN, y: y - rowHeight }, thickness: 0.5, color: lineColor });
      y -= rowHeight;
      consumed += lines.length;
      if (consumed < description.length) {
        newPage(true);
        tableHeader();
      }
    }
  }
  y -= 20;
  const totals = [];
  if (snapshot.kind === "change_order" && snapshot.change_totals) {
    const amounts = snapshot.change_totals;
    const delta = amount(amounts.change_amount);
    totals.push({ label: "Current total", value: money(amounts.current_total) }, { label: "This change", value: `${delta > 0 ? "+" : ""}${money(amounts.change_amount)}` }, { label: "Revised total", value: money(amounts.revised_total), grand: true });
    if (amount(amounts.deposit_paid) > 0) totals.push({ label: "Deposit paid", value: money(amounts.deposit_paid) });
    if (amount(amounts.other_paid) > 0) totals.push({ label: "Other payments recorded", value: money(amounts.other_paid) });
    const paid = amount(amounts.deposit_paid) + amount(amounts.other_paid);
    if (paid > 0) {
      const remaining = amount(amounts.revised_total) - paid;
      totals.push({ label: remaining < 0 ? "Credit or refund to review" : "Remaining if approved", value: money(Math.abs(remaining)) });
    }
  } else {
    totals.push({ label: "Subtotal", value: money(snapshot.subtotal) }, { label: "Tax", value: money(snapshot.tax_amount) });
    if (snapshot.kind === "invoice" && amount(snapshot.deposit_credit) > 0) totals.push({ label: "Deposit credited", value: `-${money(snapshot.deposit_credit)}` });
    if (snapshot.kind === "invoice") {
      totals.push({ label: "Invoice total", value: money(snapshot.total) });
      if (amount(snapshot.amount_paid) > 0) totals.push({ label: "Payments recorded", value: `-${money(snapshot.amount_paid)}` });
      totals.push({ label: "Amount due", value: money(snapshot.balance_due, amount(snapshot.total)), grand: true });
    } else totals.push({ label: snapshot.kind === "estimate" ? "Estimated total" : "Proposed change total", value: money(snapshot.total), grand: true });
  }
  ensure(totals.length * 26 + 8);
  const summaryPage = page;
  const summaryTop = y;
  for (const total of totals) {
    if (total.grand) page.drawRectangle({ x: 302, y: y - 25, width: 266, height: 28, color: pale });
    draw(total.label, 312, y - 5, total.grand ? 10 : 9, total.grand ? bold : regular, total.grand ? ink : muted);
    right(total.value, 556, y - 5, total.grand ? 12 : 10, bold, ink, 107);
    y -= 26;
  }
  const totalsBottom = y;
  y = summaryTop;
  section(snapshot.kind === "estimate" ? "Estimate terms" : "Message to customer", text(snapshot.customer_message), 242);
  if (snapshot.kind === "invoice") {
    section("Payment instructions", text(snapshot.payment_instructions), 242);
  }
  if (page === summaryPage) y = Math.min(y, totalsBottom);
  section("Notes", text(snapshot.company.document_footer));
  for (let index = 0; index < pages.length; index++) {
    page = pages[index];
    page.drawLine({ start: { x: MARGIN, y: 46 }, end: { x: PAGE_WIDTH - MARGIN, y: 46 }, thickness: 0.5, color: lineColor });
    const reference = wrap(`${label} ${number}`, 225, 8)[0];
    draw(reference, MARGIN, 35, 8, regular, muted);
    right(`Page ${index + 1} of ${pages.length}`, PAGE_WIDTH - MARGIN, 35, 8, regular, muted, 100);
    if (snapshot.finviant_branding) draw("Created with Finviant Office Assistant", MARGIN, 22, 7, regular, muted);
  }
  return pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
var DOCUMENT_PDF_TEMPLATE_VERSION, PAGE_WIDTH, PAGE_HEIGHT, MARGIN, CONTENT_WIDTH, BOTTOM, ink, textColor, muted, lineColor, pale, white, generatePdf;
var init_documentPdf = __esm({
  "shared/documentPdf.ts"() {
    DOCUMENT_PDF_TEMPLATE_VERSION = "finviant-document-1";
    PAGE_WIDTH = 612;
    PAGE_HEIGHT = 792;
    MARGIN = 44;
    CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
    BOTTOM = 64;
    ink = rgb(0.059, 0.153, 0.278);
    textColor = rgb(0.13, 0.18, 0.24);
    muted = rgb(0.36, 0.42, 0.49);
    lineColor = rgb(0.83, 0.87, 0.91);
    pale = rgb(0.95, 0.97, 0.98);
    white = rgb(1, 1, 1);
    generatePdf = generateDocumentPdf;
  }
});

// supabase/functions/_shared/documentEmail.ts
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// supabase/functions/_shared/providerRequest.ts
var ProviderRequestError = class extends Error {
  constructor(code, status = 0) {
    super("Provider request failed: " + code);
    this.code = code;
    this.status = status;
    this.name = "ProviderRequestError";
  }
  code;
  status;
};
async function providerJson(url, init, options = {}) {
  const timeoutMs = options.timeoutMs ?? 45e3;
  const maxBytes = options.maxBytes ?? 1048576;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError("Invalid provider request bounds");
  const controller = new AbortController();
  let reader;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void reader?.cancel().catch(() => {
      });
      reject(new ProviderRequestError("timeout"));
    }, timeoutMs);
  });
  const attempt = (async () => {
    try {
      const response = await (options.fetcher ?? fetch)(url, { ...init, signal: controller.signal });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {
        });
        throw new ProviderRequestError("timeout");
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {
        });
        throw new ProviderRequestError("http", response.status);
      }
      if (Number(response.headers.get("content-length") || 0) > maxBytes) {
        void response.body?.cancel().catch(() => {
        });
        throw new ProviderRequestError("too_large");
      }
      if (!response.body) throw new ProviderRequestError("invalid_response");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let length = 0, text2 = "";
      while (true) {
        const chunk = await reader.read();
        if (controller.signal.aborted) throw new ProviderRequestError("timeout");
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > maxBytes) {
          void reader.cancel().catch(() => {
          });
          throw new ProviderRequestError("too_large");
        }
        text2 += decoder.decode(chunk.value, { stream: true });
      }
      text2 += decoder.decode();
      let parsed;
      try {
        parsed = JSON.parse(text2);
      } catch {
        throw new ProviderRequestError("invalid_response");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ProviderRequestError("invalid_response");
      return parsed;
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      if (controller.signal.aborted) throw new ProviderRequestError("timeout");
      throw new ProviderRequestError("network");
    } finally {
      try {
        reader?.releaseLock();
      } catch {
      }
    }
  })();
  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    if (timer !== void 0) clearTimeout(timer);
  }
}

// supabase/functions/_shared/appEnvironment.ts
var environments = {
  "https://xvybcmyoblfgzokaifsx.supabase.co": {
    name: "staging",
    baseUrl: "https://finviant.com",
    origins: [
      "https://finviant.com",
      "https://www.finviant.com",
      "https://finviant-office-git-feature-velnu-stage1-mbarone5-1747.vercel.app",
      "https://finviant-office-git-ux-private-testing-20261029-mbarone5-1747.vercel.app",
      "https://finviant-office-9h30ixf54-mbarone5-1747.vercel.app",
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ]
  },
  "https://qusmeexjbwphoezlcmie.supabase.co": {
    name: "production",
    baseUrl: "https://finviant.com",
    origins: ["https://finviant.com", "https://www.finviant.com"]
  }
};
function resolveAppEnvironment(projectUrl, configuredOrigin) {
  const environment = environments[projectUrl];
  if (!environment) return null;
  const baseUrl = configuredOrigin || environment.baseUrl;
  const origins = environment.origins;
  if (!baseUrl.startsWith("https://") || !origins.includes(baseUrl)) return null;
  return { name: environment.name, baseUrl, origins };
}

// supabase/functions/_shared/emailRelease.ts
function emailDeliveryMode(get = (name) => Deno.env.get(name)) {
  const environment = resolveAppEnvironment(get("SUPABASE_URL"), get("FINVIANT_APP_BASE_URL"));
  if (!environment || !get("RESEND_API_KEY") || !get("RESEND_WEBHOOK_SECRET")) return "disabled";
  if (environment.name === "staging") {
    return get("FINVIANT_PRIVATE_BETA_EMAIL_ENABLED") === "true" ? "private_beta" : "disabled";
  }
  return get("FINVIANT_CUSTOMER_EMAIL_ENABLED") === "true" ? "production" : "disabled";
}

// supabase/functions/_shared/documentPdfArtifact.ts
var DOCUMENT_PDF_BUCKET = "finviant-document-pdfs";
var DOCUMENT_PDF_MAX_BYTES = 8e6;
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function documentPdfPath(version) {
  if (![version.version_id, version.business_id, version.document_id].every((id) => UUID.test(id)) || !["invoice", "estimate", "change_order"].includes(version.kind)) throw new Error("INVALID_DOCUMENT_VERSION");
  return `${version.business_id}/${version.kind}/${version.document_id}/${version.version_id}.pdf`;
}
function documentPdfFilename(snapshot) {
  const kind = snapshot.kind === "change_order" ? "Change-order" : snapshot.kind === "estimate" ? "Estimate" : "Invoice";
  const number = String(snapshot.number || "").replace(/[^A-Za-z0-9_.-]/g, "-").replace(/^[.-]+/, "").slice(0, 75);
  return `${kind}${number ? "-" + number : ""}.pdf`;
}
async function pdfSha256(bytes) {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}
function pdfBase64(bytes) {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
  return btoa(binary);
}
function validPdf(bytes) {
  return bytes.length > 8 && bytes.length <= DOCUMENT_PDF_MAX_BYTES && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
}
async function versionLogo(admin, version) {
  const path = version.snapshot.company?.logo_path;
  if (!path) return void 0;
  if (typeof path !== "string" || !path.startsWith(version.business_id + "/") || path.length > 200 || path.includes("..") || !/^[A-Za-z0-9_./-]+$/.test(path)) throw new Error("INVALID_DOCUMENT_LOGO_PATH");
  const { data, error } = await admin.storage.from("velnu-business-logos").download(path);
  if (error || !data || data.size > 2e6) throw new Error("DOCUMENT_LOGO_UNAVAILABLE");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return { bytes, mimeType: "image/png" };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { bytes, mimeType: "image/jpeg" };
  throw new Error("DOCUMENT_LOGO_FORMAT_UNSUPPORTED");
}
async function ensureStoredDocumentPdf(admin, versionId) {
  if (!UUID.test(versionId)) throw new Error("INVALID_DOCUMENT_VERSION");
  const { data: version, error } = await admin.rpc("document_pdf_artifact_context", { p_version: versionId }).abortSignal(AbortSignal.timeout(5e3));
  if (error || !version) throw new Error("DOCUMENT_VERSION_UNAVAILABLE");
  const context = version;
  if (context.version_id !== versionId) throw new Error("DOCUMENT_VERSION_SCOPE_MISMATCH");
  const path = documentPdfPath(context);
  if (context.pdf_bucket && context.pdf_bucket !== DOCUMENT_PDF_BUCKET || context.pdf_path && context.pdf_path !== path) throw new Error("INVALID_DOCUMENT_PDF_PATH");
  const cached = await admin.storage.from(DOCUMENT_PDF_BUCKET).download(path);
  if (!cached.error && cached.data) {
    if (cached.data.size > DOCUMENT_PDF_MAX_BYTES) throw new Error("DOCUMENT_PDF_TOO_LARGE");
    const bytes2 = new Uint8Array(await cached.data.arrayBuffer()), sha2562 = await pdfSha256(bytes2);
    if (!validPdf(bytes2) || context.pdf_sha256 && sha2562 !== context.pdf_sha256) throw new Error("DOCUMENT_PDF_INTEGRITY_FAILED");
    const registration2 = await admin.rpc("register_document_pdf_artifact", { p_version: versionId, p_sha256: sha2562, p_byte_size: bytes2.length }).abortSignal(AbortSignal.timeout(5e3));
    if (registration2.error) throw new Error("DOCUMENT_PDF_REGISTRATION_FAILED");
    return { bytes: bytes2, sha256: sha2562, filename: documentPdfFilename(context.snapshot), versionId };
  }
  const { generateDocumentPdf: generateDocumentPdf2 } = await Promise.resolve().then(() => (init_documentPdf(), documentPdf_exports));
  const logo = await versionLogo(admin, context);
  const bytes = await generateDocumentPdf2(context.snapshot, { logo }), sha256 = await pdfSha256(bytes);
  if (!validPdf(bytes)) throw new Error("DOCUMENT_PDF_RENDER_FAILED");
  if (context.pdf_sha256 && sha256 !== context.pdf_sha256) throw new Error("DOCUMENT_PDF_INTEGRITY_FAILED");
  const reservation = await admin.rpc("reserve_document_pdf_artifact", { p_version: versionId, p_byte_size: bytes.length }).abortSignal(AbortSignal.timeout(5e3));
  if (reservation.error) throw new Error(reservation.error.message === "PDF_STORAGE_ALLOWANCE_REACHED" ? "PDF_STORAGE_ALLOWANCE_REACHED" : "DOCUMENT_PDF_RESERVATION_FAILED");
  const uploaded = await admin.storage.from(DOCUMENT_PDF_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false, cacheControl: "0" });
  if (uploaded.error) {
    const concurrent = await admin.storage.from(DOCUMENT_PDF_BUCKET).download(path);
    if (concurrent.error || !concurrent.data || concurrent.data.size > DOCUMENT_PDF_MAX_BYTES || await pdfSha256(new Uint8Array(await concurrent.data.arrayBuffer())) !== sha256) throw new Error("DOCUMENT_PDF_SAVE_UNCONFIRMED");
  }
  const registration = await admin.rpc("register_document_pdf_artifact", { p_version: versionId, p_sha256: sha256, p_byte_size: bytes.length }).abortSignal(AbortSignal.timeout(5e3));
  if (registration.error) throw new Error("DOCUMENT_PDF_REGISTRATION_FAILED");
  return { bytes, sha256, filename: documentPdfFilename(context.snapshot), versionId };
}
async function prepareQueuedDocumentPdf(admin, claim) {
  if (!claim.document_version_id) return claim.payload;
  if (Array.isArray(claim.payload.attachments) && claim.payload.attachments.length) return claim.payload;
  const artifact = await ensureStoredDocumentPdf(admin, claim.document_version_id);
  const frozen = await admin.rpc("freeze_document_email_attachment", {
    p_request: claim.id,
    p_lease: claim.lease,
    p_version: artifact.versionId,
    p_filename: artifact.filename,
    p_content: pdfBase64(artifact.bytes),
    p_sha256: artifact.sha256
  }).abortSignal(AbortSignal.timeout(1e4));
  if (frozen.error || !frozen.data || !Array.isArray(frozen.data.attachments) || !frozen.data.attachments.length) throw new Error("DOCUMENT_PDF_PAYLOAD_NOT_FROZEN");
  return frozen.data;
}

// supabase/functions/_shared/emailDispatch.ts
async function dispatchQueuedEmail(admin, resend, id, trace) {
  const mode = emailDeliveryMode();
  if (mode === "disabled") return { status: 503, body: { error: "Email delivery is not enabled. No email was sent.", code: "email_not_enabled" } };
  const { data: claim, error: claimError } = await admin.rpc("claim_document_email", { p_request: id, p_pdf_capable: true }).abortSignal(AbortSignal.timeout(5e3));
  if (claimError || !claim) return { status: 503, body: { error: "The saved send could not be claimed. Retry the same send, not a new message." } };
  if (["accepted", "delivered"].includes(claim.status)) return { status: 200, body: { status: claim.status, email_id: claim.provider_id, recipient: claim.recipient || "the saved customer address", already_sent: true, send_id: claim.id } };
  if (claim.status !== "claimed") return { status: 409, body: { error: claim.status === "busy" ? "This send is already processing or waiting for its retry interval." : "This send needs support review before another attempt.", code: claim.status, send_id: claim.id } };
  if (mode === "private_beta") {
    let allowed = false, unavailable = false;
    try {
      const approval = await admin.rpc("private_beta_email_recipient_allowed", { p_request: claim.id }).abortSignal(AbortSignal.timeout(5e3));
      unavailable = !!approval.error;
      allowed = !approval.error && approval.data === true;
    } catch {
      unavailable = true;
    }
    if (!allowed) {
      const code = unavailable ? "beta_configuration_unavailable" : "beta_recipient_not_approved";
      let closed = false;
      try {
        const stopped = await admin.rpc("stop_private_beta_email", { p_request: claim.id, p_lease: claim.lease, p_code: code }).abortSignal(AbortSignal.timeout(5e3));
        closed = !stopped.error && stopped.data === true;
      } catch {
      }
      if (!closed) return { status: 503, body: { error: "This saved send needs review because an earlier delivery or stopping the operation could not be confirmed. Keep this same send identifier and check its activity before trying again; do not start another send.", code: "beta_stop_unconfirmed", send_id: claim.id } };
      return { status: unavailable ? 503 : 403, body: { error: unavailable ? "Private beta recipient approval is unavailable. No email was sent. After setup is restored, review the document and start a new send." : "Private beta email requires an approved test recipient. No email was sent. Review the recipient and start a new send after approval.", code, send_id: claim.id, beta_send_not_started: true } };
    }
  }
  let payload;
  try {
    payload = await prepareQueuedDocumentPdf(admin, claim);
  } catch {
    try {
      await admin.rpc("release_document_pdf_claim", { p_request: claim.id, p_lease: claim.lease }).abortSignal(AbortSignal.timeout(5e3));
    } catch {
    }
    return { status: 503, body: { error: "The saved PDF could not be prepared. No email was sent by this attempt. Retry this same saved send after its waiting period.", code: "pdf_artifact_unavailable", send_id: claim.id } };
  }
  let sent;
  try {
    sent = await providerJson("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + resend, "Content-Type": "application/json", "Idempotency-Key": "finviant-outbox-" + claim.id }, body: JSON.stringify(payload) }, { timeoutMs: 2e4, maxBytes: 65536 });
    if (typeof sent.id !== "string" || !sent.id.trim() || sent.id.length > 200) throw new Error("INVALID_RECEIPT");
  } catch (err) {
    const definitive = err instanceof ProviderRequestError && err.code === "http" && [400, 401, 403, 404, 422].includes(err.status || 0);
    const code = err instanceof ProviderRequestError ? err.code : "invalid_receipt";
    await admin.rpc("finish_document_email", { p_request: claim.id, p_lease: claim.lease, p_result: definitive ? "failed" : "uncertain", p_provider_id: null, p_code: code }).abortSignal(AbortSignal.timeout(5e3));
    console.warn(JSON.stringify({ service: "document-email", request_id: trace, code }));
    return { status: 502, body: { error: "Delivery was not confirmed. The original request is saved; retry that same send after its waiting period. Do not start a new send.", code: "delivery_unconfirmed", send_id: claim.id } };
  }
  const { error: saveError } = await admin.rpc("finish_document_email", { p_request: claim.id, p_lease: claim.lease, p_result: "accepted", p_provider_id: sent.id, p_code: null }).abortSignal(AbortSignal.timeout(5e3));
  return { status: 200, body: { status: "accepted", email_id: sent.id, recipient: payload.to[0], send_id: claim.id, warning: saveError ? "Provider accepted the email but local reconciliation is pending. Do not create a new send." : null } };
}

// supabase/functions/_shared/signedEvents.ts
var enc = new TextEncoder();
async function readLimitedRequest(req, maxBytes = 262144) {
  if (Number(req.headers.get("content-length") || 0) > maxBytes) throw new Error("REQUEST_TOO_LARGE");
  if (!req.body) return "";
  const reader = req.body.getReader(), chunks = [];
  let timer, size = 0;
  try {
    return await Promise.race([
      (async () => {
        for (; ; ) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new Error("REQUEST_TOO_LARGE");
          chunks.push(value);
        }
        const all = new Uint8Array(size);
        let at = 0;
        for (const chunk of chunks) {
          all.set(chunk, at);
          at += chunk.byteLength;
        }
        return new TextDecoder("utf-8", { fatal: true }).decode(all);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("REQUEST_TIMEOUT")), 5e3);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => {
    });
    chunks.length = 0;
  }
}

// supabase/functions/_shared/documentEmail.ts
var UUID2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function documentEmailHandler(invoiceOnly, reminder = false, businessCard = false) {
  return async (req) => {
    const trace = crypto.randomUUID(), origin = req.headers.get("origin") || "";
    const environment = resolveAppEnvironment(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("FINVIANT_APP_BASE_URL")
    );
    const headers = {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-request-id": trace,
      ...environment?.origins.includes(origin) ? { "access-control-allow-origin": origin } : {},
      "access-control-allow-headers": "authorization,apikey,x-client-info,content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      vary: "Origin"
    };
    const respond = (status, body) => new Response(JSON.stringify({ ...body, request_id: trace }), {
      status,
      headers
    });
    if (!environment)
      return respond(503, {
        error: "Application environment is not configured."
      });
    if (origin && !environment.origins.includes(origin))
      return respond(403, { error: "This app address is not authorized." });
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST")
      return respond(405, { error: "Method not allowed." });
    const auth = req.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer "))
      return respond(401, { error: "Sign in to send a document." });
    try {
      const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !anon || !service)
        return respond(503, { error: "Email service is not configured." });
      const caller = createClient(url, anon, {
        global: { headers: { Authorization: auth } },
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const { data: identity, error: authError } = await caller.auth.getUser();
      if (authError || !identity.user)
        return respond(401, { error: "Session expired. Sign in again." });
      const resend = Deno.env.get("RESEND_API_KEY"), webhook = Deno.env.get("RESEND_WEBHOOK_SECRET");
      if (emailDeliveryMode() === "disabled" || !resend || !webhook)
        return respond(503, {
          error: "Customer email is awaiting verified delivery configuration. No message was queued or sent.",
          code: "email_not_enabled"
        });
      let input;
      try {
        input = JSON.parse(await readLimitedRequest(req, 16384));
      } catch {
        return respond(400, { error: "Invalid or oversized request." });
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        return respond(400, { error: "Invalid request." });
      const business = String(input.business_id || ""), document = String(
        (invoiceOnly ? input.invoice_id : input.document_id) || ""
      ), operation = String(input.request_id || "");
      const kind = invoiceOnly ? "invoice" : String(input.document_type || "");
      if (![business, document, operation].every((v) => UUID2.test(v)) || !invoiceOnly && !(businessCard ? kind === "business_card" : ["estimate", "change_order"].includes(kind)))
        return respond(400, {
          error: "A valid business, document and persistent send identifier are required."
        });
      if (input.expected_recipient !== void 0 && (typeof input.expected_recipient !== "string" || input.expected_recipient.length > 254 || !input.expected_recipient.trim()))
        return respond(400, {
          error: "A valid reviewed recipient is required."
        });
      if (input.expected_revision_id !== void 0 && (typeof input.expected_revision_id !== "string" || !UUID2.test(input.expected_revision_id)))
        return respond(400, {
          error: "A valid reviewed document version is required."
        });
      if (businessCard && (document !== business || typeof input.expected_recipient !== "string" || typeof input.expected_revision_id !== "string"))
        return respond(400, {
          error: "Review the saved business card and recipient before sending."
        });
      const admin = createClient(url, service, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const version = input.expected_revision_id !== void 0 ? { p_expected_revision_id: input.expected_revision_id } : {};
      const { data: prepared, error: prepError } = await admin.rpc(
        businessCard ? "prepare_business_card_email" : reminder ? "prepare_invoice_reminder_email" : input.expected_recipient !== void 0 ? "prepare_review_document_email" : "prepare_document_email",
        businessCard ? {
          p_actor: identity.user.id,
          p_business: business,
          p_request: operation,
          p_recipient: input.expected_recipient,
          p_expected_revision: input.expected_revision_id
        } : reminder ? {
          p_actor: identity.user.id,
          p_business: business,
          p_document: document,
          p_request: operation,
          p_review: input.review,
          ...version
        } : {
          p_actor: identity.user.id,
          p_business: business,
          p_kind: kind,
          p_document: document,
          p_request: operation,
          p_origin: environment.baseUrl,
          ...input.expected_recipient !== void 0 ? { p_recipient: input.expected_recipient } : {},
          ...version
        }
      ).abortSignal(AbortSignal.timeout(5e3));
      if (prepError?.message === "DOCUMENT_VERSION_CHANGED")
        return respond(409, {
          error: "This document changed after the PDF was reviewed. Reopen its final PDF before sending.",
          code: "document_version_changed"
        });
      if (prepError?.message === "PENDING_DOCUMENT_VERSION_CONFLICT")
        return respond(409, {
          error: "An earlier saved send uses a different document version. Check its activity before retrying; do not start another send until its outcome is confirmed.",
          code: "pending_document_version_conflict"
        });
      if (prepError?.message === "BETA_EMAIL_RECIPIENT_NOT_APPROVED")
        return respond(403, {
          error: "Private beta email requires an approved test recipient. No email was queued or sent. Review the recipient before trying again.",
          code: "beta_recipient_not_approved",
          beta_send_not_started: true
        });
      if (businessCard && prepError)
        return respond(prepError.code === "42501" ? 403 : 409, {
          error: prepError.message,
          code: "card_send_not_queued"
        });
      if (prepError || !prepared)
        return respond(prepError?.code === "42501" ? 403 : 409, {
          error: prepError?.code === "23514" ? reminder ? "Invoice, customer, or pending-send details changed. Reload the reminder and check invoice activity before sending." : "Customer or pending-send details changed. Open the saved document and review its recipient before sending." : "Unable to queue the document. Check account permissions, plan, recipient and document status."
        });
      const result = await dispatchQueuedEmail(
        admin,
        resend,
        prepared.id,
        trace
      );
      return respond(result.status, result.body);
    } catch {
      console.error(
        JSON.stringify({
          service: "document-email",
          request_id: trace,
          code: "unexpected"
        })
      );
      return respond(500, {
        error: "The send outcome is not confirmed. Keep the same send identifier when retrying."
      });
    }
  };
}

// supabase/functions/send-business-card/index.ts
Deno.serve(documentEmailHandler(false, false, true));
