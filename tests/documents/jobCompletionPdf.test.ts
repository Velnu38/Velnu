import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { generateJobCompletionPdf } from "../../shared/jobCompletionPdf.ts";
import type { CompletionSnapshot } from "../../src/services/jobExecution.ts";
export const completionSample: CompletionSnapshot = {
  business: {
    name: "Harbor Home Services",
    phone: "757-555-0100",
    email: "office@example.test",
  },
  job: {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Kitchen cabinet installation",
    customer: "Taylor Morgan",
    address: "100 Example Lane, Chesapeake, VA",
    completed_at: "2026-11-09T16:00:00Z",
  },
  summary:
    "Installed cabinets, aligned doors and drawers, and tested all hardware. Protected flooring and removed work debris. Reviewed care instructions with the customer.",
  tasks: [
    { title: "Protect floors and verify measurements", completed: true },
    { title: "Install cabinet doors and hardware", completed: true },
    { title: "Final inspection and site cleanup", completed: true },
  ],
  visits: [
    {
      title: "Preparation & layout",
      starts_at: "2026-11-06T14:00:00Z",
      ends_at: "2026-11-06T16:00:00Z",
      status: "completed",
    },
    {
      title: "Installation",
      starts_at: "2026-11-09T14:00:00Z",
      ends_at: "2026-11-09T16:00:00Z",
      status: "completed",
    },
  ],
  photos: [],
  signoff: {
    name: "Taylor Morgan",
    statement: "I acknowledge the work described in this completion report.",
    method: "Typed in person",
    captured_at: "2026-11-09T16:05:00Z",
    captured_by: "22222222-2222-4222-8222-222222222222",
  },
  created_at: "2026-11-09T16:06:00Z",
  version: 1,
};
test("completion PDF renders the saved report with Unicode, pagination, acknowledgement and private photo bytes", async () => {
  const pdf = await generateJobCompletionPdf(completionSample, async () => {
    throw Error("No photo load expected");
  });
  const document = await PDFDocument.load(pdf);
  assert.equal(document.getPageCount(), 1);
  assert.equal(
    document.getTitle(),
    "Kitchen cabinet installation - completion report",
  );
  await mkdir("tmp/pdfs", { recursive: true });
  await writeFile("tmp/pdfs/job-completion-sample.pdf", pdf);
  const long = {
    ...completionSample,
    job: {
      ...completionSample.job,
      title: "Réparation & installation – résumé",
    },
    tasks: Array.from({ length: 70 }, (_, i) => ({
      title:
        `Inspection ${i + 1}: ` + "A long checklist description ".repeat(5),
      completed: i % 4 !== 0,
    })),
    photos: [
      {
        id: "photo",
        name: "Selected job photo",
        path: "private-photo",
        media_type: "image/png",
      },
    ],
  };
  let loads = 0;
  const result = await generateJobCompletionPdf(long, async (path) => {
    assert.equal(path, "private-photo");
    loads++;
    return new Uint8Array(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNIcAAAAASUVORK5CYII=",
        "base64",
      ),
    );
  });
  assert.equal(loads, 1);
  assert.ok((await PDFDocument.load(result)).getPageCount() > 3);
  await writeFile("tmp/pdfs/job-completion-long.pdf", result);
  await assert.rejects(
    generateJobCompletionPdf(
      { ...completionSample, photos: long.photos },
      async () => {
        throw Error("Photo inaccessible");
      },
    ),
    /Photo inaccessible/,
  );
});
