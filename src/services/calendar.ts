import { dayBounds } from "../lib/calendarTime";
import { supabase } from "../lib/supabase";
export type CalendarProvider = "google" | "outlook";
export type CalendarIntegration = {
  id: string;
  provider: CalendarProvider;
  email: string;
  calendar_id: string;
  calendar_name: string;
  auto_sync: boolean;
  state: string;
  last_synced_at: string | null;
  last_error: string | null;
};
export type CalendarOption = { id: string; name: string };
export async function calendarRequest<T>(
  action: string,
  businessId: string,
  method = "GET",
  values: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Please sign in again.");
  const params = new URLSearchParams({ action });
  if (method === "GET") {
    params.set("businessId", businessId);
    for (const [k, v] of Object.entries(values)) params.set(k, String(v));
  }
  const response = await fetch(`/api/calendar?${params}`, {
    method,
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
    },
    ...(method !== "GET"
      ? { body: JSON.stringify({ businessId, ...values }) }
      : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "Calendar connections are awaiting server setup. Your Finviant schedule remains available.",
    );
  const result = await response.json();
  if (!response.ok) {
    const messages: Record<string, string> = {
      calendar_setup_required:
        "Calendar connections are awaiting server setup. Your Finviant schedule remains available.",
      calendar_not_configured:
        "Calendar connections are awaiting server setup.",
      authorization_revoked:
        "Calendar access expired or was revoked. Reconnect to continue.",
      reconnect_required: "Reconnect this calendar account to continue.",
      provider_rate_limited:
        "Your calendar provider is busy. Please try again shortly.",
      disconnect_previous_account_first:
        "Disconnect the existing account before choosing a different account.",
    };
    throw new Error(
      messages[result.error] ||
        "Unable to update the calendar connection. Please try again.",
    );
  }
  return result as T;
}
export type AgendaWork = {
  source_key: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  document_kind: string;
  document_id: string;
};
export type AgendaReminder = {
  id: string;
  note: string | null;
  due_at: string;
  job_id: string | null;
};
export async function loadAgenda(
  businessId: string,
  day: string,
  zone: string,
) {
  const { from, to } = dayBounds(day, zone);
  // Include work spanning midnight and all pending reminders through this day.
  const [work, reminders] = await Promise.all([
    supabase
      .from("calendar_work")
      .select("*", { count: "exact" })
      .eq("business_id", businessId)
      .lt("starts_at", to)
      .or(`ends_at.gt.${from},and(ends_at.is.null,starts_at.gte.${from})`)
      .order("starts_at")
      .limit(200),
    supabase
      .from("reminders")
      .select("id,note,due_at,job_id", { count: "exact" })
      .eq("business_id", businessId)
      .eq("status", "pending")
      .lt("due_at", to)
      .order("due_at")
      .limit(200),
  ]);
  if (work.error || reminders.error) throw work.error || reminders.error;
  return {
    work: (work.data || []) as AgendaWork[],
    reminders: (reminders.data || []) as AgendaReminder[],
    limited: (work.count || 0) > 200 || (reminders.count || 0) > 200,
  };
}
export function announceCalendarChange() {
  window.dispatchEvent(new Event("finviant-work-changed"));
}
