import { test } from "node:test";
import assert from "node:assert/strict";
import { GoogleCalendarService } from "../../server/calendar/google.js";
import { OutlookCalendarService } from "../../server/calendar/outlook.js";
process.env.GOOGLE_CALENDAR_CLIENT_ID = "test";
process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "test";
process.env.OUTLOOK_CALENDAR_CLIENT_ID = "test";
process.env.OUTLOOK_CALENDAR_CLIENT_SECRET = "test";
process.env.CALENDAR_APP_ORIGIN = "https://finviant.example";
const input = {
  key: "stable-key",
  title: "Work",
  description:
    "Open invoice https://finviant.example/?view=invoices&document=id",
  start: "2026-11-02T15:00:00.000Z",
  end: "2026-11-02T16:00:00.000Z",
  timezone: "America/New_York",
};
test("Google creates with stable ID, updates on retry, and treats already deleted events as success", async () => {
  const service = new GoogleCalendarService(
    {
      access_token: "test",
      refresh_token: "test",
      expiry_date: Date.now() + 3600000,
    },
    async () => {},
  );
  const calls: unknown[] = [];
  let present = false;
  const mock = {
    events: {
      patch: async (args: unknown) => {
        calls.push(args);
        if (!present) throw { response: { status: 404 } };
        return {};
      },
      insert: async (args: unknown) => {
        calls.push(args);
        present = true;
        return {};
      },
      delete: async () => {
        throw { response: { status: 410 } };
      },
    },
  };
  (service as unknown as { api: unknown }).api = mock;
  const id = await service.upsert("primary", null, input);
  assert.match(id, /^fv[a-f0-9]{64}$/);
  assert.equal(await service.upsert("primary", null, input), id);
  assert.equal(calls.length, 3);
  await service.remove("primary", id);
});
test("Google refresh persists a rotated token before the event call and revoked refresh fails safely", async () => {
  const saved: unknown[] = [];
  const service = new GoogleCalendarService(
    { refresh_token: "old", expiry_date: 0 },
    async (tokens) => {
      saved.push(tokens);
    },
  );
  const internals = service as unknown as {
    auth: {
      refreshAccessToken: () => Promise<unknown>;
      credentials: Record<string, unknown>;
      setCredentials: (v: unknown) => void;
    };
    api: unknown;
  };
  internals.auth.refreshAccessToken = async () => ({
    credentials: {
      access_token: "new",
      refresh_token: "rotated",
      expiry_date: Date.now() + 3600000,
    },
  });
  internals.api = {
    calendarList: {
      list: async () => {
        assert.equal(saved.length, 1);
        return { data: { items: [{ id: "c", summary: "Work" }] } };
      },
    },
  };
  assert.deepEqual(await service.calendars(), [{ id: "c", name: "Work" }]);
  assert.equal(
    (saved[0] as { refresh_token: string }).refresh_token,
    "rotated",
  );
  const revoked = new GoogleCalendarService(
    { refresh_token: "old" },
    async () => {},
  );
  (
    revoked as unknown as { auth: { refreshAccessToken: () => Promise<never> } }
  ).auth.refreshAccessToken = async () => {
    throw { response: { status: 400, data: { error: "invalid_grant" } } };
  };
  await assert.rejects(() => revoked.calendars(), /authorization_revoked/);
});
test("Outlook recovers uncertain creations using a correlation property; UTC payload and CRUD routes are exact", async () => {
  const service = new OutlookCalendarService({}, async () => {}),
    paths: string[] = [],
    bodies: unknown[] = [];
  let exists = false;
  const chain = {
    header: () => chain,
    option: () => chain,
    middlewareOptions: () => chain,
    filter: () => chain,
    select: () => chain,
    top: () => chain,
    get: async () => ({ value: exists ? [{ id: "remote" }] : [] }),
    post: async (body: unknown) => {
      bodies.push(body);
      exists = true;
      return { id: "remote" };
    },
    patch: async (body: unknown) => {
      bodies.push(body);
    },
    delete: async () => {},
  };
  (service as unknown as { client: unknown }).client = {
    api: (path: string) => {
      paths.push(path);
      return chain;
    },
  };
  assert.equal(await service.upsert("primary", null, input), "remote");
  assert.equal(await service.upsert("primary", null, input), "remote");
  await service.remove("primary", "remote");
  assert(paths.includes("/me/events"));
  assert(paths.includes("/me/events/remote"));
  const first = bodies[0] as {
    start: { dateTime: string; timeZone: string };
    transactionId: string;
    attendees?: unknown;
  };
  assert.equal(first.start.timeZone, "UTC");
  assert.equal(first.start.dateTime, "2026-11-02T15:00:00.000");
  assert(first.transactionId);
  assert.equal(first.attendees, undefined);
});
