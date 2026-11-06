import { createClient } from "@supabase/supabase-js";
import { CalendarError, classify, log } from "./errors.js";
import { database, required, appOrigin } from "./db.js";
export const uuid = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new CalendarError("invalid_identifier", false, 0, 400);
  return value;
};
export function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...headers,
    },
  });
}
export async function actor(req: Request, businessId: string, requirePaid = true) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer "))
    throw new CalendarError("sign_in_required", false, 0, 401);
  const url = required("VITE_SUPABASE_URL");
  const client = createClient(url, required("VITE_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
    },
  });
  const { data, error } = await client.auth.getUser(authorization.slice(7));
  if (error || !data.user)
    throw new CalendarError("sign_in_required", false, 0, 401);
  const { rows } = await database().query(
    "select role,private.effective_plan(business_id) as plan from public.business_members where business_id=$1 and user_id=$2 and 'calendar'=any(access_modules)",
    [businessId, data.user.id],
  );
  if (!rows[0])
    throw new CalendarError("workspace_access_denied", false, 0, 403);
  if(requirePaid && rows[0].plan === "free") throw new CalendarError("paid_calendar_required", false, 0, 403);
  return { id: data.user.id, role: rows[0].role as string };
}
export function checkOrigin(req: Request) {
  if (req.headers.get("origin") !== appOrigin())
    throw new CalendarError("invalid_origin", false, 0, 403);
}
export function errorResponse(e: unknown) {
  const issue = classify(e);
  log("sync_failed", { reason: issue.reason, stage: "api" });
  return json(
    { error: issue.reason },
    issue.status >= 400 && issue.status <= 599 ? issue.status : 500,
  );
}
export async function body(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > 8192)
    throw new CalendarError("request_too_large", false, 0, 413);
  const value = await req.text();
  if (value.length > 8192)
    throw new CalendarError("request_too_large", false, 0, 413);
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new CalendarError("invalid_request", false, 0, 400);
  }
}
