import { DateTime } from "luxon";
import { digest } from "./crypto.js";
import { CalendarError } from "./errors.js";
import type { EventInput, Work } from "./types.js";
export function eventInput(
  work: Work,
  key: string,
  origin: string,
): EventInput {
  const start = new Date(work.starts_at),
    end = work.ends_at ? new Date(work.ends_at) : null;
  if (
    !Number.isFinite(start.getTime()) ||
    !end ||
    !Number.isFinite(end.getTime()) ||
    end <= start
  )
    throw new CalendarError("schedule_requires_end_time");
  if (!DateTime.now().setZone(work.timezone).isValid)
    throw new CalendarError("invalid_timezone");
  const url = new URL("/", origin);
  url.searchParams.set(
    "view",
    work.document_kind === "invoice"
      ? "invoices"
      : work.document_kind === "estimate"
        ? "estimates"
        : "work",
  );
  url.searchParams.set("document", work.document_id);
  return {
    key,
    title: work.title,
    description: `${work.description ? `${work.description}\n\n` : ""}Open in Finviant Office: ${url.href}`,
    start: start.toISOString(),
    end: end.toISOString(),
    timezone: work.timezone,
  };
}
export const fingerprint = (event: EventInput) => digest(JSON.stringify(event));
