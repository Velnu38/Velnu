import type { PoolClient } from "pg";
import { decrypt, encrypt } from "./crypto.js";
import type { Integration, Tokens } from "./types.js";
import { GoogleCalendarService } from "./google.js";
import { OutlookCalendarService } from "./outlook.js";
import { CalendarError } from "./errors.js";
/** Caller holds the integration FOR UPDATE lock for serialized token rotation. */
export function provider(db: PoolClient, integration: Integration) {
  if (!integration.credentials)
    throw new CalendarError("authorization_revoked");
  const tokens = decrypt<Tokens>(integration.credentials, integration.id);
  const save = async (next: Tokens) => {
    await db.query(
      "update private.calendar_integrations set credentials=$2,updated_at=now() where id=$1",
      [integration.id, encrypt(next, integration.id)],
    );
  };
  return integration.provider === "google"
    ? new GoogleCalendarService(tokens, save)
    : new OutlookCalendarService(tokens, save);
}
