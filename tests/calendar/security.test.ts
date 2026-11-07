import { test } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt, equalSecret, digest } from "../../server/calendar/crypto.js";
import { database } from "../../server/calendar/db.js";
import { classify, retrySeconds } from "../../server/calendar/errors.js";
import { eventInput } from "../../server/calendar/reconcile.js";
import { calendarApi } from "../../server/calendar/api.js";
import { GET as worker } from "../../api/calendar-worker.js";
import { GET as outlookCallback } from "../../api/calendar-outlook-callback.js";
import { outlookRedirect } from "../../server/calendar/outlook.js";
process.env.CALENDAR_TOKEN_KEYS = JSON.stringify({
  v1: Buffer.alloc(32, 1).toString("base64"),
});
process.env.CALENDAR_APP_ORIGIN = "https://finviant.example";
test("encrypted credentials authenticate their integration and reject tampering", () => {
  const original = { refresh_token: "secret" },
    envelope = encrypt(original, "integration-a");
  assert.deepEqual(decrypt(envelope, "integration-a"), original);
  assert(!JSON.stringify(envelope).includes("secret"));
  assert.throws(() => decrypt(envelope, "integration-b"));
  assert.throws(() =>
    decrypt(
      { ...envelope, tag: Buffer.alloc(16).toString("base64url") },
      "integration-a",
    ),
  );
  assert(equalSecret("abc", "abc"));
  assert(!equalSecret("abc", "abd"));
});
test("provider revocation and throttling classification never leaks SDK payloads", () => {
  assert.equal(
    classify({
      response: {
        status: 400,
        data: { error: "invalid_grant", refresh_token: "secret" },
      },
    }).reason,
    "authorization_revoked",
  );
  const issue = classify({
    statusCode: 429,
    response: { headers: { "retry-after": "120" } },
  });
  assert(issue.retryable);
  assert.equal(issue.retryAfter, 120);
  assert(
    classify({
      response: {
        status: 403,
        data: { error: { errors: [{ reason: "rateLimitExceeded" }] } },
      },
    }).retryable,
  );
  assert.equal(
    classify({ statusCode: 403 }).reason,
    "calendar_permission_denied",
  );
  assert(!classify({ statusCode: 403 }).retryable);
  assert(classify({ response: { status: 503 } }).retryable);
  assert(retrySeconds(1, 120) >= 120);
});
test("event carries exact UTC instants and deep link; absent end time rejected", () => {
  const w = {
    source_key: "x",
    title: "Work",
    description: "Approved scope",
    starts_at: "2026-11-01T01:30:00-04:00",
    ends_at: "2026-11-01T01:30:00-05:00",
    timezone: "America/New_York",
    document_kind: "invoice",
    document_id: "id",
    assigned_user_id: null,
  };
  const event = eventInput(w, "key", "https://finviant.example");
  assert.equal(event.start, "2026-11-01T05:30:00.000Z");
  assert.equal(event.end, "2026-11-01T06:30:00.000Z");
  assert.match(event.description, /view=invoices&document=id/);
  assert.throws(
    () =>
      eventInput({ ...w, ends_at: null }, "key", "https://finviant.example"),
    /schedule_requires_end_time/,
  );
});
test("worker denies missing or incorrect scheduler secret before DB access", async () => {
  delete process.env.CALENDAR_WORKER_SECRET;
  assert.equal(
    (await worker(new Request("https://finviant.example/api/calendar-worker")))
      .status,
    401,
  );
  process.env.CALENDAR_WORKER_SECRET = "test";
  assert.equal(
    (
      await worker(
        new Request("https://finviant.example/api/calendar-worker", {
          headers: { Authorization: "Bearer wrong" },
        }),
      )
    ).status,
    401,
  );
});
test("API fails closed when unconfigured, unauthenticated, cross-origin, or callback lacks state", async () => {
  delete process.env.CALENDAR_SYNC_ENABLED;
  assert.equal(
    (await calendarApi(new Request("https://finviant.example/api/calendar")))
      .status,
    503,
  );
  process.env.CALENDAR_SYNC_ENABLED = "true";
  assert.equal(
    (
      await calendarApi(
        new Request(
          "https://finviant.example/api/calendar?businessId=11111111-1111-4111-8111-111111111111",
        ),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await calendarApi(
        new Request("https://finviant.example/api/calendar?action=connect", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
          body: "{}",
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await calendarApi(
        new Request(
          "https://finviant.example/api/calendar?action=callback&provider=google&code=bad",
        ),
      )
    ).status,
    400,
  );
});

test("declined OAuth returns to calendar settings and clears the browser nonce", async (t) => {
  process.env.CALENDAR_SYNC_ENABLED = "true";
  process.env.CALENDAR_DATABASE_URL = "postgres://localhost/calendar-test";
  const state = "s".repeat(40), browser = "b".repeat(40);
  const pool = database();
  const queries: string[] = [];
  t.mock.method(pool, "connect", async () => ({
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: sql.startsWith("select * from private.calendar_oauth_states") ? [{
        provider: "google", browser_hash: digest(browser), expires_at: new Date(Date.now() + 60_000).toISOString(),
      }] : [] };
    },
    release() {},
  }));
  const response = await calendarApi(new Request(
    `https://finviant.example/api/calendar?action=callback&provider=google&error=access_denied&state=${state}`,
    { headers: { Cookie: `__Host-fv-calendar-google=${browser}` } },
  ));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "https://finviant.example/?view=settings&section=calendar&calendar=declined");
  assert.match(response.headers.get("Set-Cookie") || "", /Max-Age=0/);
  assert(queries.some(sql => sql.startsWith("delete from private.calendar_oauth_states")));
});

test("Outlook uses a query-free redirect and its callback preserves state validation", async (t) => {
  assert.equal(outlookRedirect(), "https://finviant.example/api/calendar-outlook-callback");
  process.env.CALENDAR_SYNC_ENABLED = "true";
  process.env.CALENDAR_DATABASE_URL = "postgres://localhost/calendar-test";
  const state = "o".repeat(40), browser = "n".repeat(40);
  const pool = database(), consumed: string[] = [];
  t.mock.method(pool, "connect", async () => ({
    query: async (sql: string) => {
      if (sql.startsWith("delete from private.calendar_oauth_states")) consumed.push(sql);
      return { rows: sql.startsWith("select * from private.calendar_oauth_states") ? [{
        provider: "outlook", browser_hash: digest(browser), expires_at: new Date(Date.now() + 60_000).toISOString(),
      }] : [] };
    },
    release() {},
  }));
  const url = `${outlookRedirect()}?error=access_denied&state=${state}`;
  const invalidHeaders: HeadersInit[] = [{}, { Cookie: `__Host-fv-calendar-google=${browser}` }, { Cookie: "__Host-fv-calendar-outlook=wrong" }];
  for (const headers of invalidHeaders) {
    const rejected = await outlookCallback(new Request(url, { headers }));
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), { error: "invalid_oauth_state" });
  }
  assert.equal(consumed.length, 0);
  // Query values cannot change this endpoint into another action or provider.
  const declined = await outlookCallback(new Request(`${url}&action=list&provider=google`, {
    headers: { Cookie: `__Host-fv-calendar-outlook=${browser}` },
  }));
  assert.equal(declined.status, 303);
  assert.equal(declined.headers.get("Location"), "https://finviant.example/?view=settings&section=calendar&calendar=declined");
  assert.match(declined.headers.get("Set-Cookie") || "", /^__Host-fv-calendar-outlook=.*Max-Age=0/);
  assert.equal(consumed.length, 1);
});
