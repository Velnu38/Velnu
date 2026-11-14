import { DateTime } from 'luxon';
import type { ProviderEvent } from '../../src/lib/calendarTypes.js';
import { Client, RetryHandlerOptions } from "@microsoft/microsoft-graph-client";
import {
  ConfidentialClientApplication,
  type INetworkModule,
} from "@azure/msal-node";
import { appOrigin, required } from "./db.js";
import { digest } from "./crypto.js";
import { classify, CalendarError } from "./errors.js";
import type { CalendarService, EventInput, Tokens } from "./types.js";
export const outlookScopes = [
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Calendars.ReadWrite",
  "offline_access",
];
export const outlookRedirect = () =>
  `${appOrigin()}/api/calendar-outlook-callback`;
// All provider network calls are bounded, including Entra metadata/token discovery.
const network: INetworkModule = {
  async sendGetRequestAsync<T>(
    url: string,
    options?: { headers?: Record<string, string>; body?: string },
  ) {
    const r = await fetch(url, {
      headers: options?.headers,
      signal: AbortSignal.timeout(10_000),
    });
    return {
      headers: Object.fromEntries(r.headers),
      body: (await r.json()) as T,
      status: r.status,
    };
  },
  async sendPostRequestAsync<T>(
    url: string,
    options?: { headers?: Record<string, string>; body?: string },
  ) {
    const r = await fetch(url, {
      method: "POST",
      headers: options?.headers,
      body: options?.body,
      signal: AbortSignal.timeout(10_000),
    });
    return {
      headers: Object.fromEntries(r.headers),
      body: (await r.json()) as T,
      status: r.status,
    };
  },
};
export function microsoftAuth(
  tokens: Tokens = {},
  save?: (tokens: Tokens) => Promise<void>,
) {
  const msal = new ConfidentialClientApplication({
    auth: {
      clientId: required("OUTLOOK_CALENDAR_CLIENT_ID"),
      clientSecret: required("OUTLOOK_CALENDAR_CLIENT_SECRET"),
      authority: "https://login.microsoftonline.com/common",
    },
    system: {
      networkClient: network,
      loggerOptions: { loggerCallback: () => {} },
    },
    cache: {
      cachePlugin: {
        beforeCacheAccess: async (c) => {
          if (tokens.msalCache) c.tokenCache.deserialize(tokens.msalCache);
        },
        afterCacheAccess: async (c) => {
          if (c.cacheHasChanged) {
            tokens.msalCache = c.tokenCache.serialize();
            if (save) await save(tokens);
          }
        },
      },
    },
  });
  return msal;
}
const propertyId =
  "String {5bc5c0eb-9a89-4fdc-b98f-0fb641a0f463} Name FinviantKey";
export class OutlookCalendarService implements CalendarService {
  private client: Client;
  constructor(tokens: Tokens, save: (tokens: Tokens) => Promise<void>) {
    const auth = microsoftAuth(tokens, save);
    this.client = Client.initWithMiddleware({
      authProvider: {
        getAccessToken: async () => {
          try {
            const account = tokens.homeAccountId
              ? await auth
                  .getTokenCache()
                  .getAccountByHomeId(tokens.homeAccountId)
              : null;
            if (!account) throw new CalendarError("authorization_revoked");
            const result = await auth.acquireTokenSilent({
              account,
              scopes: outlookScopes,
            });
            if (!result?.accessToken)
              throw new CalendarError("authorization_revoked");
            return result.accessToken;
          } catch (e) {
            throw classify(e);
          }
        },
      },
      fetchOptions: { signal: AbortSignal.timeout(60_000) },
    });
  }
  private request(path: string) {
    return this.client
      .api(path)
      .header("Prefer", 'IdType="ImmutableId"')
      .option("signal", AbortSignal.timeout(10_000))
      .middlewareOptions([new RetryHandlerOptions(1, 0)]);
  }
  async calendars() {
    const items: Array<{ id: string; name: string }> = [];
    const seen = new Set<string>();
    let pages = 0;
    let path: string | undefined =
      "/me/calendars?$select=id,name,canEdit&$top=100";
    try {
      do {
        const page = await this.request(path).get();
        for (const c of page.value || [])
          if (c.canEdit) items.push({ id: c.id, name: c.name || c.id });
        const next = page["@odata.nextLink"] as string | undefined;
        pages++;
        if (next) {
          const u = new URL(next);
          if (
            u.origin !== "https://graph.microsoft.com" ||
            u.pathname !== "/v1.0/me/calendars" ||
            u.username || u.password || u.hash || seen.has(next)
          )
            throw new CalendarError("invalid_provider_pagination");
          if (pages >= 20) throw new CalendarError("too_many_calendars");
          seen.add(next);
          path = u.pathname.replace("/v1.0", "") + u.search;
        } else path = undefined;
        if (items.length > 2000) throw new CalendarError("too_many_calendars");
      } while (path);
      return items;
    } catch (e) {
      throw classify(e);
    }
  }
  private collection(calendarId: string) {
    return calendarId === "primary"
      ? "/me/events"
      : `/me/calendars/${encodeURIComponent(calendarId)}/events`;
  }
  async events(calendarId: string, from: string, to: string, timezone: string): Promise<ProviderEvent[]> {
    const collection = calendarId === 'primary' ? '/me/calendar/calendarView' : `/me/calendars/${encodeURIComponent(calendarId)}/calendarView`;
    const query = new URLSearchParams({ startDateTime: from, endDateTime: to, '$top': '1000', '$expand': `singleValueExtendedProperties($filter=id eq '${propertyId}')` });
    let path: string | undefined = `${collection}?${query}`;
    const seen = new Set<string>(), events: ProviderEvent[] = [];
    try {
      do {
        const page = await this.request(path).header('Prefer', `IdType="ImmutableId", outlook.timezone="${timezone}", outlook.body-content-type="text"`).get();
        for (const item of page.value || []) {
          if (!item.id || item.isCancelled || item.singleValueExtendedProperties?.some((p: { id: string }) => p.id === propertyId)) continue;
          const start = DateTime.fromISO(item.start?.dateTime || '', { zone: timezone }), end = DateTime.fromISO(item.end?.dateTime || '', { zone: timezone });
          if (!start.isValid || !end.isValid) continue;
          events.push({ id: item.id, title: item.subject || 'Untitled event', description: item.body?.content || item.bodyPreview || '', location: item.location?.displayName || '', starts_at: start.toISO()!, ends_at: end.toISO()!, all_day: !!item.isAllDay, ...(item.isAllDay ? { start_date: start.toISODate()!, end_date: end.toISODate()! } : {}), url: item.webLink || null });
        }
        const next = page['@odata.nextLink'] as string | undefined;
        if (next) {
          const url = new URL(next);
          if (url.origin !== 'https://graph.microsoft.com' || url.pathname !== `/v1.0${collection}` || seen.has(next) || seen.size >= 10) throw new CalendarError('invalid_provider_pagination');
          seen.add(next); path = url.pathname.slice(5) + url.search;
        } else path = undefined;
      } while (path);
      return events;
    } catch (error) { throw classify(error); }
  }
  async upsert(
    calendarId: string,
    eventId: string | null,
    event: EventInput,
  ): Promise<string> {
    // Graph accepts UTC dateTimeTimeZone; converting the instant to UTC avoids
    // ambiguous DST wall times and Windows/IANA identifier mismatches.
    const body = {
      subject: event.title,
      body: { contentType: "text", content: event.description },
      start: { dateTime: event.start.replace(/Z$/, ""), timeZone: "UTC" },
      end: { dateTime: event.end.replace(/Z$/, ""), timeZone: "UTC" },
      isReminderOn: true,
      reminderMinutesBeforeStart: 15,
    };
    try {
      let id = eventId;
      if (!id) {
        // Recover an event created before a process crash or lost HTTP response.
        const key = digest(event.key);
        const existing = await this.request(this.collection(calendarId))
          .filter(
            `singleValueExtendedProperties/Any(ep: ep/id eq '${propertyId}' and ep/value eq '${key}')`,
          )
          .select("id")
          .top(2)
          .get();
        id = existing.value?.[0]?.id || null;
        if (!id) {
          const created = await this.request(this.collection(calendarId)).post({
            ...body,
            transactionId: key,
            singleValueExtendedProperties: [{ id: propertyId, value: key }],
          });
          if (!created.id)
            throw new CalendarError("provider_missing_event_id", true);
          return created.id;
        }
      }
      await this.request(`/me/events/${encodeURIComponent(id!)}`).patch(body);
      return id!;
    } catch (e) {
      throw classify(e);
    }
  }
  async remove(_calendarId: string, eventId: string) {
    try {
      await this.request(`/me/events/${encodeURIComponent(eventId)}`).delete();
    } catch (e) {
      if (![404, 410].includes(classify(e).status)) throw classify(e);
    }
  }
}
