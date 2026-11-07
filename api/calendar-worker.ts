import { equalSecret } from "../server/calendar/crypto.js";
import { json, errorResponse } from "../server/calendar/http.js";
import { runSyncBatch } from "../server/calendar/worker.js";
/** Invoke every minute using a scheduler configured for the private staging environment. */
export async function GET(req: Request) {
  const secret = process.env.CALENDAR_WORKER_SECRET;
  if (
    !secret ||
    !equalSecret(req.headers.get("authorization") || "", `Bearer ${secret}`)
  )
    return json({ error: "unauthorized" }, 401);
  if (process.env.CALENDAR_SYNC_ENABLED !== "true")
    return json({ error: "calendar_setup_required" }, 503);
  try {
    return json(await runSyncBatch());
  } catch (e) {
    return errorResponse(e);
  }
}
