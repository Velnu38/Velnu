import pg from "pg";
import { CalendarError } from "./errors.js";
let pool: pg.Pool | undefined;
export function database() {
  if (!process.env.CALENDAR_DATABASE_URL)
    throw new CalendarError("calendar_not_configured", false, 0, 503);
  // Use the Supabase transaction pooler and a dedicated server role. Never disable TLS verification.
  return (pool ??= new pg.Pool({
    connectionString: process.env.CALENDAR_DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 5000,
    ssl:
      process.env.NODE_ENV === "test"
        ? false
        : {
            rejectUnauthorized: true,
            ...(process.env.CALENDAR_DATABASE_CA
              ? { ca: process.env.CALENDAR_DATABASE_CA }
              : {}),
          },
  }));
}
export async function transaction<T>(fn: (db: pg.PoolClient) => Promise<T>) {
  const db = await database().connect();
  try {
    await db.query("begin");
    await db.query(
      "set local statement_timeout='20s'; set local lock_timeout='3s'",
    );
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
  }
}
export async function enqueue(db: pg.PoolClient, id: string) {
  await db.query(
    `insert into private.calendar_sync_queue(integration_id) values($1) on conflict(integration_id)
    do update set revision=private.calendar_sync_queue.revision+1,available_at=now(),attempts=0,dead=false`,
    [id],
  );
}
export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new CalendarError("calendar_not_configured", false, 0, 503);
  return value;
}
export function appOrigin() {
  const url = new URL(required("CALENDAR_APP_ORIGIN"));
  if (url.protocol !== "https:" && url.hostname !== "localhost")
    throw new Error("HTTPS required");
  return url.origin;
}
