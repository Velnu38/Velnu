export class CalendarError extends Error {
  constructor(
    public reason: string,
    public retryable = false,
    public retryAfter = 0,
    public status = 500,
  ) {
    super(reason);
  }
}
/** Never log SDK errors: they can contain Authorization headers, tokens and event bodies. */
export function classify(error: unknown): CalendarError {
  if (error instanceof CalendarError) return error;
  const e = error as {
    statusCode?: number;
    code?: string | number;
    errorCode?: string;
    headers?: Headers;
    response?: {
      status?: number;
      data?: { error?: string | { errors?: Array<{ reason?: string }> } };
      headers?: Record<string, string> | Headers;
    };
  };
  const status = Number(e?.statusCode || e?.response?.status || e?.code || 0);
  const data = e?.response?.data?.error;
  const reason = typeof data === "string" ? data : e?.errorCode || e?.code;
  if (
    [
      "invalid_grant",
      "interaction_required",
      "consent_required",
      "invalid_token",
    ].includes(String(reason)) ||
    status === 401
  )
    return new CalendarError("authorization_revoked", false, 0, 401);
  const quota =
    typeof data === "object" &&
    data?.errors?.some((x) =>
      ["rateLimitExceeded", "userRateLimitExceeded"].includes(x.reason || ""),
    );
  if (status === 429 || quota) {
    // GraphError carries response headers at the top level; Google uses response.headers.
    const h = e.headers ?? e.response?.headers;
    const value =
      h instanceof Headers ? h.get("retry-after") : h?.["retry-after"];
    const seconds = value ? Number(value) : 0;
    const delay = Number.isFinite(seconds)
      ? seconds
      : Math.ceil((Date.parse(value || "") - Date.now()) / 1000);
    return new CalendarError(
      "provider_rate_limited",
      true,
      Math.max(1, Math.min(delay || 60, 86400)),
      429,
    );
  }
  if (status === 404 || status === 410)
    return new CalendarError("event_not_found", false, 0, status);
  if (status === 409)
    return new CalendarError("event_already_exists", false, 0, status);
  if (status === 403)
    return new CalendarError("calendar_permission_denied", false, 0, 403);
  if (status >= 500 || !status)
    return new CalendarError("provider_unavailable", true);
  return new CalendarError("provider_request_rejected", false, 0, status);
}
export function retrySeconds(attempt: number, minimum = 0) {
  return Math.max(
    minimum,
    Math.min(3600, 2 ** Math.min(attempt, 10) * 5) +
      Math.floor(Math.random() * 10),
  );
}
export function log(
  event: "sync_initiated" | "sync_success" | "sync_failed",
  fields: Record<string, string | number | boolean | null>,
) {
  console.log(JSON.stringify({ event, ...fields }));
}
