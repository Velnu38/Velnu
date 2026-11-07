import type { ProviderEvent } from '../../src/lib/calendarTypes.js';
export type Provider = "google" | "outlook";
export type Calendar = { id: string; name: string };
export type Tokens = {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  msalCache?: string;
  homeAccountId?: string;
};
export type Envelope = { kid: string; iv: string; tag: string; data: string };
export type Integration = {
  id: string;
  business_id: string;
  user_id: string;
  provider: Provider;
  account_id: string;
  email: string;
  calendar_id: string;
  calendar_name: string;
  auto_sync: boolean;
  state: string;
  credentials: Envelope | null;
  last_error: string | null;
  last_synced_at: string | null;
};
export type Work = {
  source_key: string;
  title: string;
  description: string;
  starts_at: Date | string;
  ends_at: Date | string | null;
  timezone: string;
  document_kind: string;
  document_id: string;
  assigned_user_id: string | null;
  assigned_user_ids?: string[];
  job_id?: string | null;
};
export type EventInput = {
  key: string;
  title: string;
  description: string;
  start: string;
  end: string;
  timezone: string;
};
export interface CalendarService {
  calendars(): Promise<Calendar[]>;
  events(calendarId: string, from: string, to: string, timezone: string): Promise<ProviderEvent[]>;
  upsert(
    calendarId: string,
    eventId: string | null,
    event: EventInput,
  ): Promise<string>;
  remove(calendarId: string, eventId: string): Promise<void>;
}
