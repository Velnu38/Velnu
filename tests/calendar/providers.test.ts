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

test('Google day agenda follows pagination, expands recurrence, keeps all-day dates, and excludes canceled/exported entries',async()=>{
 const svc=new GoogleCalendarService({access_token:'test',refresh_token:'test',expiry_date:Date.now()+3600000},async()=>{})
 const calls:any[]=[]
 ;(svc as unknown as {api:unknown}).api={events:{list:async(args:any)=>{calls.push(args);return {data:args.pageToken?{items:[{id:'timed',summary:'Recurrence occurrence',start:{dateTime:input.start},end:{dateTime:input.end}}]}:{items:[{id:'all',summary:'All day',start:{date:'2026-11-02'},end:{date:'2026-11-03'}},{id:'exported',extendedProperties:{private:{finviantKey:'key'}}},{id:'canceled',status:'cancelled'}],nextPageToken:'next'}}}}}
 const events=await svc.events('primary',input.start,input.end,'America/New_York')
 assert.equal(calls.length,2);assert.equal(calls[0].singleEvents,true);assert.equal(calls[0].showDeleted,false);assert.equal(calls[1].pageToken,'next');assert.deepEqual(events.map(item=>item.id),['all','timed']);assert.equal(events[0].start_date,'2026-11-02');assert.equal(events[0].starts_at,'2026-11-02T00:00:00.000-05:00')
})
test('Outlook day agenda expands calendarView, follows only its own pagination, and requests text bodies in the business timezone',async()=>{
 const svc=new OutlookCalendarService({},async()=>{}),paths:string[]=[],headers:string[]=[]
 let unsafe=false
 const chain={header:(_name:string,value:string)=>{headers.push(value);return chain},option:()=>chain,middlewareOptions:()=>chain,get:async()=>({value:[{id:'event-'+paths.length,subject:'Meeting',body:{content:'Bring plans'},start:{dateTime:'2026-11-02T09:00:00',timeZone:'America/New_York'},end:{dateTime:'2026-11-02T10:00:00',timeZone:'America/New_York'}},{id:'canceled',isCancelled:true},{id:'exported',singleValueExtendedProperties:[{id:'String {5bc5c0eb-9a89-4fdc-b98f-0fb641a0f463} Name FinviantKey'}]}],...(unsafe?{'@odata.nextLink':'https://attacker.example/events'}:paths.length===1?{'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/calendar/calendarView?$skip=1'}:{})})}
 ;(svc as unknown as {client:unknown}).client={api:(path:string)=>{paths.push(path);return chain}}
 const events=await svc.events('primary',input.start,input.end,'America/New_York')
 assert.equal(events.length,2);assert.equal(events[0].starts_at,'2026-11-02T09:00:00.000-05:00');assert.match(paths[0],/^\/me\/calendar\/calendarView\?/);assert.ok(headers.some(value=>value.includes('outlook.timezone="America/New_York"')&&value.includes('outlook.body-content-type="text"')))
 unsafe=true;await assert.rejects(()=>svc.events('primary',input.start,input.end,'America/New_York'),/invalid_provider_pagination/)
})
