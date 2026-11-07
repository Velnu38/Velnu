import { calendarApi } from "../server/calendar/api.js";

/** Personal Microsoft accounts require a registered redirect URI without a query. */
export function GET(req: Request) {
  const url = new URL(req.url);
  url.searchParams.set("action", "callback");
  url.searchParams.set("provider", "outlook");
  return calendarApi(new Request(url, req));
}
