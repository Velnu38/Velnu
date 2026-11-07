import { asList } from './relations';
import { formatServiceAddress } from '../lib/googleMaps';
import type { ConnectedAgenda } from '../lib/calendarTypes';
import type { AgendaWork, AgendaReminder } from '../lib/calendarTypes';
export type { AgendaWork, AgendaReminder } from '../lib/calendarTypes';
import { collectWorkbookPages } from "../lib/workbookPages";
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
export type CalendarConnections = {
  integrations: CalendarIntegration[];
  providers?: Partial<Record<CalendarProvider, boolean>>;
};
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
      paid_calendar_required: "External calendar connections require Individual or Business Pro. Your Finviant calendar remains available.",
      calendar_setup_required:
        "Google and Outlook connections need administrator setup in Finviant before you can connect your account.",
      calendar_not_configured:
        "Google and Outlook connections need administrator setup in Finviant before you can connect your account.",
      google_calendar_setup_required:
        "Google Calendar needs administrator setup in Finviant before you can connect your account.",
      outlook_calendar_setup_required:
        "Microsoft Outlook needs administrator setup in Finviant before you can connect your account.",
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
export {announceCalendarChange} from '../lib/workEvents'

/** Load the whole visible range. Paginate instead of silently dropping busy days. */
export async function loadCalendarRange(businessId: string, startDay: string, endDay: string, zone: string) {
  const from = dayBounds(startDay, zone).from, to = dayBounds(endDay, zone).from
  const [work, reminders] = await Promise.all([
    collectWorkbookPages(async (offset, last) => {
      const result = await supabase.from('calendar_work')
        .select('*', { count: 'exact' }).eq('business_id', businessId)
        .lt('starts_at', to).or(`ends_at.gt.${from},and(ends_at.is.null,starts_at.gte.${from})`)
        .order('source_key').range(offset, last)
      return { ...result, data: result.data?.map(row => ({ ...row, id: row.source_key })) ?? null }
    }),
    collectWorkbookPages((offset, last) => supabase.from('reminders')
      .select('id,note,due_at,job_id,status', { count: 'exact' }).eq('business_id', businessId)
      .in('status', ['pending', 'completed']).gte('due_at', from).lt('due_at', to).order('id').range(offset, last)),
  ])
  const ids = [...new Set(work.map(row => row.job_id).filter(Boolean))]
  const jobs: Record<string, any> = {}
  let detailsUnavailable = false
  for (let start = 0; start < ids.length; start += 100) {
    try {
      const rows = await collectWorkbookPages((offset, last) => supabase.from('jobs')
        .select('id,description,customers!jobs_customer_id_fkey(first_name,last_name,company),properties!jobs_property_id_fkey(address_line1,address_line2,city,state,postal_code)', { count: 'exact' })
        .eq('business_id', businessId).in('id', ids.slice(start, start + 100)).order('id').range(offset, last))
      for (const row of rows) jobs[row.id] = row
    } catch { detailsUnavailable = true }
  }
  const detailed = work.map(item => {
    const job = jobs[item.job_id]
    if (!job) return item
    return { ...item, description: job.description || '', address: asList(job.properties).map(formatServiceAddress).join('; '), customer_name: asList(job.customers).map(customer => [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || '').join(', ') }
  })
  return { detailsUnavailable, work: detailed as unknown as AgendaWork[], reminders: (reminders as AgendaReminder[]).sort((a, b) => a.due_at.localeCompare(b.due_at)) }
}

export function loadConnectedCalendarRange(businessId: string, startDay: string, endDay: string, timezone: string) {
  return calendarRequest<ConnectedAgenda>('events', businessId, 'GET', { startDay, endDay, timezone })
}
