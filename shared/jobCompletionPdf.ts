import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { documentPdfFonts } from "./fonts/dejavuSans";
import type { CompletionSnapshot } from "../src/services/jobExecution";
/** Renders only the saved report snapshot. Internal prices and private notes are absent. */
export async function generateJobCompletionPdf(
  snapshot: CompletionSnapshot,
  photoLoader: (path: string) => Promise<Uint8Array>,
) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const bytes = documentPdfFonts(),
    regular = await pdf.embedFont(bytes.regular, { subset: true }),
    bold = await pdf.embedFont(bytes.bold, { subset: true });
  const supported = new Set(regular.getCharacterSet()),
    accent = rgb(0.08, 0.32, 0.23),
    ink = rgb(0.12, 0.17, 0.15),
    muted = rgb(0.38, 0.43, 0.4);
  let page!: PDFPage,
    y = 0,
    totalPhotoBytes = 0;
  const check = (s: string) => {
    for (const c of s) {
      if (c !== "\n" && !supported.has(c.codePointAt(0)!))
        throw Error(
          "The report font cannot display a character in this report. Contact support for an additional document font.",
        );
    }
    return s;
  };
  function newPage() {
    page = pdf.addPage([612, 792]);
    y = 735;
    page.drawText("FINVIANT  /  JOB COMPLETION", {
      x: 48,
      y: 759,
      size: 8,
      font: bold,
      color: accent,
    });
    page.drawLine({
      start: { x: 48, y: 749 },
      end: { x: 564, y: 749 },
      thickness: 1,
      color: rgb(0.84, 0.9, 0.86),
    });
  }
  function ensure(h: number) {
    if (y - h < 55) newPage();
  }
  function lines(text: string, size = 10, width = 516) {
    const result: string[] = [];
    for (const paragraph of check(String(text || ""))
      .replace(/\r/g, "")
      .split("\n")) {
      let current = "";
      for (const c of paragraph) {
        if (regular.widthOfTextAtSize(current + c, size) > width && current) {
          result.push(current);
          current = "";
        }
        current += c;
      }
      result.push(current);
    }
    return result;
  }
  function text(value: string, size = 10, strong = false, color = ink) {
    for (const line of lines(value, size)) {
      ensure(size + 6);
      if (line)
        page.drawText(line, {
          x: 48,
          y: y - size,
          size,
          font: strong ? bold : regular,
          color,
        });
      y -= size + 6;
    }
  }
  function heading(value: string) {
    ensure(45);
    y -= 12;
    text(value, 12, true, accent);
    y -= 3;
  }
  const date = (iso: string | null) =>
    iso ? new Date(iso).toISOString().slice(0, 10) : "Not recorded";
  newPage();
  text(snapshot.business.name, 19, true);
  text(
    [snapshot.business.phone, snapshot.business.email]
      .filter(Boolean)
      .join("  |  "),
    9,
    false,
    muted,
  );
  heading("Completion report - version " + snapshot.version);
  text(snapshot.job.title, 15, true);
  text("Customer: " + snapshot.job.customer);
  if (snapshot.job.address) text(snapshot.job.address);
  text(
    "Job reference: " +
      snapshot.job.id.slice(0, 8).toUpperCase() +
      "  |  Completed: " +
      date(snapshot.job.completed_at),
    9,
    false,
    muted,
  );
  heading("Work performed");
  text(snapshot.summary);
  heading("Work checklist");
  if (!snapshot.tasks.length) text("No checklist was recorded.");
  snapshot.tasks.forEach((t) =>
    text((t.completed ? "[Complete] " : "[Open] ") + t.title),
  );
  heading("Visits");
  if (!snapshot.visits.length) text("No visits were recorded.");
  snapshot.visits.forEach((v) =>
    text(
      date(v.starts_at) +
        "  |  " +
        v.title +
        "  |  " +
        v.status.replaceAll("_", " "),
    ),
  );
  heading("Customer acknowledgement");
  if (snapshot.signoff) {
    text(snapshot.signoff.statement);
    text(snapshot.signoff.name, 14, true);
    text(
      snapshot.signoff.method +
        " - captured " +
        new Date(snapshot.signoff.captured_at)
          .toISOString()
          .replace("T", " ")
          .slice(0, 19) +
        " UTC",
      9,
      false,
      muted,
    );
    text(
      "Captured on the business device. This record does not verify the signer’s identity or authorize a payment.",
      9,
      false,
      muted,
    );
  } else text("No customer acknowledgement was recorded.");
  text(
    "Report created: " +
      date(snapshot.created_at) +
      ". This saved version is retained when a later report is created.",
    8,
    false,
    muted,
  );
  for (let i = 0; i < snapshot.photos.length; i++) {
    const photo = snapshot.photos[i],
      data = await photoLoader(photo.path);
    totalPhotoBytes += data.byteLength;
    if (totalPhotoBytes > 40_000_000)
      throw Error(
        "Selected photos are too large for one report PDF. Publish a new version with fewer photos.",
      );
    const png=[137,80,78,71,13,10,26,10].every((v,n)=>data[n]===v);
    const jpeg=data[0]===255&&data[1]===216&&data[2]===255;
    const img=png?await pdf.embedPng(data):jpeg?await pdf.embedJpg(data):null;
    if (!img) throw Error("A selected photo has an unsupported PDF format.");
    const scale = Math.min(516 / img.width, 270 / img.height, 1),
      w = img.width * scale,
      h = img.height * scale;
    ensure(h + 75);
    heading("Photo " + (i + 1));
    page.drawImage(img, { x: 48, y: y - h, width: w, height: h });
    y -= h + 8;
    text(photo.name, 9, false, muted);
  }
  pdf.getPages().forEach((p, i) => {
    p.drawText(
      "Job " +
        snapshot.job.id.slice(0, 8).toUpperCase() +
        "  |  Report v" +
        snapshot.version,
      { x: 48, y: 29, size: 8, font: regular, color: muted },
    );
    p.drawText(`${i + 1} / ${pdf.getPageCount()}`, {
      x: 525,
      y: 29,
      size: 8,
      font: regular,
      color: muted,
    });
  });
  pdf.setTitle(snapshot.job.title + " - completion report");
  pdf.setCreator("Finviant Office");
  pdf.setCreationDate(new Date(snapshot.created_at));
  pdf.setModificationDate(new Date(snapshot.created_at));
  const output = await pdf.save();
  if (output.byteLength > 25_000_000)
    throw Error(
      "This report exceeds the PDF size limit. Publish a version with fewer photos.",
    );
  return output;
}
