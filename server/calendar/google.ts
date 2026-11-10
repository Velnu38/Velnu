import { DateTime } from 'luxon';
import type { ProviderEvent } from '../../src/lib/calendarTypes.js';
import { calendar } from "googleapis/build/src/apis/calendar/index.js";
import { OAuth2Client } from "google-auth-library";
import { classify, CalendarError } from "./errors.js";
import { appOrigin, required } from "./db.js";
import { digest } from "./crypto.js";
import type { CalendarService, EventInput, Tokens } from "./types.js";
export const googleScopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];
export function googleAuth() {
  return new OAuth2Client({
    clientId: required("GOOGLE_CALENDAR_CLIENT_ID"),
    clientSecret: required("GOOGLE_CALENDAR_CLIENT_SECRET"),
    redirectUri: `${appOrigin()}/api/calendar?action=callback&provider=google`,
    transporterOptions: { timeout: 10_000, retry: false },
  });
}
export class GoogleCalendarService implements CalendarService {
  private auth: OAuth2Client;
  private api: ReturnType<typeof calendar>;
  constructor(
    private tokens: Tokens,
    private save: (tokens: Tokens) => Promise<void>,
  ) {
    this.auth = googleAuth();
    this.auth.setCredentials(tokens);
    this.api = calendar({ version: "v3", auth: this.auth });
  }
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      if (!this.tokens.refresh_token)
        throw new CalendarError("authorization_revoked");
      if (
        !this.tokens.access_token ||
        !this.tokens.expiry_date ||
        this.tokens.expiry_date < Date.now() + 120_000
      ) {
        const { credentials } = await this.auth.refreshAccessToken();
        this.tokens = {
          ...this.tokens,
          ...credentials,
          refresh_token: credentials.refresh_token || this.tokens.refresh_token,
        } as Tokens;
        this.auth.setCredentials(this.tokens);
        await this.save(this.tokens);
      }
      return await fn();
    } catch (e) {
      throw classify(e);
    } finally {
      // SDK may refresh on a 401; persist rotation synchronously before returning.
      const next = {
        ...this.tokens,
        ...this.auth.credentials,
        refresh_token:
          this.auth.credentials.refresh_token || this.tokens.refresh_token,
      } as Tokens;
      if (JSON.stringify(next) !== JSON.stringify(this.tokens)) {
        this.tokens = next;
        await this.save(next);
      }
    }
  }
  async calendars() {
    return this.run(async () => {
      const items: Array<{ id: string; name: string }> = [];
      let pageToken: string | undefined;
      const seen = new Set<string>();
      let pages = 0;
      do {
        const { data } = await this.api.calendarList.list(
          { minAccessRole: "writer", maxResults: 250, pageToken },
          { timeout: 10_000, retry: false },
        );
        for (const c of data.items || [])
          if (c.id) items.push({ id: c.id, name: c.summary || c.id });
        pageToken = data.nextPageToken || undefined;
        pages++;
        if (pageToken && seen.has(pageToken))
          throw new CalendarError("invalid_provider_pagination");
        if (pageToken && pages >= 20)
          throw new CalendarError("too_many_calendars");
        if (pageToken) seen.add(pageToken);
        if (items.length > 2000) throw new CalendarError("too_many_calendars");
      } while (pageToken);
      return items;
    });
  }
  async events(calendarId: string, from: string, to: string, timezone: string): Promise<ProviderEvent[]> {
    return this.run(async () => {
      const events: ProviderEvent[] = [];
      let pageToken: string | undefined;
      const seen = new Set<string>();
      do {
        const { data } = await this.api.events.list({ calendarId, timeMin: from, timeMax: to, timeZone: timezone, singleEvents: true, showDeleted: false, maxResults: 2500, pageToken }, { timeout: 10_000, retry: false });
        for (const item of data.items || []) {
          if (!item.id || item.status === 'cancelled' || item.extendedProperties?.private?.finviantKey) continue;
          const allDay = !!item.start?.date;
          const start = item.start?.dateTime || DateTime.fromISO(item.start?.date || '', { zone: timezone }).toISO();
          const end = item.end?.dateTime || DateTime.fromISO(item.end?.date || '', { zone: timezone }).toISO();
          if (!start || !end) continue;
          events.push({ id: item.id, title: item.summary || 'Untitled event', description: item.description || '', location: item.location || '', starts_at: start, ends_at: end, all_day: allDay, ...(allDay ? { start_date: item.start!.date!, end_date: item.end!.date! } : {}), url: item.htmlLink || null });
        }
        pageToken = data.nextPageToken || undefined;
        if (pageToken && (seen.has(pageToken) || seen.size >= 10)) throw new CalendarError('calendar_range_too_busy');
        if (pageToken) seen.add(pageToken);
      } while (pageToken);
      return events;
    });
  }
  async upsert(
    calendarId: string,
    eventId: string | null,
    event: EventInput,
  ): Promise<string> {
    // Hex is a valid subset of Google's base32hex event-id alphabet.
    const id = eventId || `fv${digest(event.key)}`;
    const body = {
      summary: event.title,
      description: event.description,
      start: { dateTime: event.start, timeZone: event.timezone },
      end: { dateTime: event.end, timeZone: event.timezone },
      extendedProperties: { private: { finviantKey: digest(event.key) } },
    };
    return this.run(async () => {
      try {
        await this.api.events.patch(
          { calendarId, eventId: id, requestBody: body, sendUpdates: "none" },
          { timeout: 10_000, retry: false },
        );
        return id;
      } catch (e) {
        const issue = classify(e);
        if (![404, 410].includes(issue.status)) throw issue;
        if (eventId) throw issue;
      }
      try {
        await this.api.events.insert(
          { calendarId, requestBody: { ...body, id }, sendUpdates: "none" },
          { timeout: 10_000, retry: false },
        );
        return id;
      } catch (e) {
        if (classify(e).status !== 409) throw e;
        await this.api.events.patch(
          { calendarId, eventId: id, requestBody: body, sendUpdates: "none" },
          { timeout: 10_000, retry: false },
        );
        return id;
      }
    });
  }
  async remove(calendarId: string, eventId: string) {
    await this.run(async () => {
      try {
        await this.api.events.delete(
          { calendarId, eventId, sendUpdates: "none" },
          { timeout: 10_000, retry: false },
        );
      } catch (e) {
        if (![404, 410].includes(classify(e).status)) throw e;
      }
    });
  }
}
