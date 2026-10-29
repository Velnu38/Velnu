import {
  createTranscribeVoiceHandler,
  type VoiceDependencies,
} from "./handler.ts";
import { providerJson } from "../_shared/providerRequest.ts";
const BUSINESS = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222",
  USER = "33333333-3333-4333-8333-333333333333";
const PUBLIC = "test-public",
  SECRET = "test-server-secret",
  API = "sk-test-no-real-provider";
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(a: unknown, b: unknown) {
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
  );
}
type Options = {
  expired?: boolean;
  authNull?: boolean;
  memberError?: boolean;
  usageError?: boolean;
  usage?: unknown;
  budgetCode?: string;
  emptyReservation?: boolean;
  slots?: number;
  saveError?: boolean;
  saveThrow?: boolean;
  missingID?: boolean;
  provider?: VoiceDependencies["provider"];
  env?: Record<string, string | undefined>;
  text?: unknown;
  bodyTimeoutMs?: number;
};
function fixture(options: Options = {}) {
  const state = {
    clients: [] as Array<{ key: string; options: any }>,
    filters: [] as Array<[string, unknown]>,
    calls: [] as string[],
    provider: 0,
    reservations: 0,
    saved: [] as any[],
    uploads: [] as FormData[],
  };
  let slots = options.slots ?? 1000;
  const vars: Record<string, string | undefined> = {
    SUPABASE_URL: "https://test.invalid",
    SUPABASE_ANON_KEY: PUBLIC,
    SUPABASE_SERVICE_ROLE_KEY: SECRET,
    OPENAI_API_KEY: API,
    ...options.env,
  };
  const handler = createTranscribeVoiceHandler({
    env: (key) => vars[key],
    bodyTimeoutMs: options.bodyTimeoutMs,
    createClient: (_url, key, config) => {
      state.clients.push({ key, options: config });
      equal(config.auth, { persistSession: false, autoRefreshToken: false });
      if (key === SECRET) {
        assert(
          !config.global?.headers?.Authorization,
          "Server storage must not inherit caller Authorization",
        );
      }
      return {
        auth: {
          getUser: async () => {
            state.calls.push("auth");
            return {
              data: options.authNull
                ? null
                : { user: options.expired ? null : { id: USER } },
              error: options.expired ? { code: "expired" } : null,
            };
          },
        },
        from: (table: string) => {
          if (table === "business_members") {
            assert(key === PUBLIC);
            const filters = new Map<string, unknown>();
            const q = {
              select: (_s: string) => q,
              eq: (field: string, value: unknown) => {
                filters.set(field, value);
                state.filters.push([field, value]);
                return q;
              },
              maybeSingle: async () => {
                state.calls.push("membership");
                equal(filters.get("user_id"), USER);
                return {
                  data: filters.get("business_id") === BUSINESS
                    ? { business_id: BUSINESS }
                    : null,
                  error: options.memberError ? { code: "unavailable" } : null,
                };
              },
            };
            return q;
          }
          equal(table, "voice_transcriptions");
          equal(key, SECRET);
          return {
            insert: (payload: any) => {
              state.calls.push("storage");
              state.saved.push(payload);
              return {
                select: (_s: string) => ({
                  single: async () => {
                    if (options.saveThrow) {
                      throw new Error("private storage diagnostic");
                    }
                    return {
                      data: options.missingID
                        ? {}
                        : { id: "44444444-4444-4444-8444-444444444444" },
                      error: options.saveError
                        ? { code: "private-storage-error" }
                        : null,
                    };
                  },
                }),
              };
            },
          };
        },
        rpc: async (name: string, payload: any) => {
          state.calls.push(name);
          if (name === "get_plan_usage") {
            equal(payload, { target_business_id: BUSINESS });
            return {
              data: options.usage === undefined
                ? { plan: "pro", voice_limit: 50 }
                : options.usage,
              error: options.usageError ? { code: "unavailable" } : null,
            };
          }
          equal(name, "reserve_ai_provider_attempt");
          equal(payload, { p_business_id: BUSINESS, p_kind: "transcription" });
          state.reservations++;
          if (options.budgetCode || slots-- <= 0) {
            return {
              data: null,
              error: { code: options.budgetCode ?? "P0001" },
            };
          }
          return {
            data: options.emptyReservation ? null : { reserved: true },
            error: null,
          };
        },
      };
    },
    provider: async (url, init, bounds) => {
      state.provider++;
      equal(url, "https://api.openai.com/v1/audio/transcriptions");
      equal(bounds, { timeoutMs: 60000, maxBytes: 262144 });
      equal((init.headers as any).Authorization, "Bearer " + API);
      assert(init.body instanceof FormData);
      state.uploads.push(init.body);
      if (options.provider) return options.provider(url, init, bounds);
      return {
        text: options.text === undefined
          ? "Create an invoice for Alex for $120"
          : options.text,
      };
    },
  });
  return { handler, state };
}
function upload(
  extra: Record<string, unknown> = {},
  options: {
    auth?: string;
    size?: number;
    name?: string;
    mime?: string;
    business?: unknown;
    duration?: unknown;
    noAudio?: boolean;
  } = {},
) {
  const form = new FormData();
  form.set("business_id", String(options.business ?? BUSINESS));
  form.set("duration_seconds", String(options.duration ?? 12));
  if (!options.noAudio) {
    form.set(
      "audio",
      new File(
        [new Uint8Array(options.size ?? 256)],
        options.name ?? "voice.webm",
        { type: options.mime ?? "audio/webm" },
      ),
    );
  }
  for (const [k, v] of Object.entries(extra)) form.set(k, String(v));
  return new Request("https://test.invalid/functions/v1/transcribe-voice", {
    method: "POST",
    headers: options.auth === undefined
      ? { Authorization: "Bearer session" }
      : options.auth
      ? { Authorization: options.auth }
      : {},
    body: form,
  });
}
function status(body: unknown = { business_id: BUSINESS, action: "status" }) {
  return new Request("https://test.invalid", {
    method: "POST",
    headers: {
      Authorization: "Bearer session",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
async function noProvider(
  f: ReturnType<typeof fixture>,
  req: Request,
  expected: number,
) {
  const r = await f.handler(req);
  equal(r.status, expected);
  equal(f.state.provider, 0);
  equal(f.state.saved.length, 0);
  return r;
}
Deno.test("unauthenticated and non-Bearer calls cannot reach auth, data or provider", async () => {
  for (const auth of ["", "Basic abc", "bearer invalid"]) {
    const f = fixture();
    await noProvider(f, upload({}, { auth }), 401);
    equal(f.state.clients.length, 0);
  }
});
Deno.test("expired or malformed verified session fails closed", async () => {
  for (const option of [{ expired: true }, { authNull: true }]) {
    const f = fixture(option);
    await noProvider(f, upload(), 401);
    equal(f.state.calls, ["auth"]);
  }
});
Deno.test("methods and preflight never contact provider or data", async () => {
  for (const method of ["GET", "PUT", "DELETE", "OPTIONS"]) {
    const f = fixture();
    await noProvider(
      f,
      new Request("https://test.invalid", { method }),
      method === "OPTIONS" ? 200 : 405,
    );
    equal(f.state.clients.length, 0);
  }
});
Deno.test("100 forged tenant identifiers cannot reserve or transcribe", async () => {
  for (let i = 0; i < 100; i++) {
    const f = fixture();
    await noProvider(
      f,
      upload({}, { business: i % 2 ? OTHER : "forged-" + i }),
      i % 2 ? 403 : 400,
    );
    equal(f.state.reservations, 0);
  }
});
Deno.test("membership service failure is denied even when a row is returned", async () => {
  const f = fixture({ memberError: true });
  await noProvider(f, upload(), 403);
});
Deno.test("body user ID, transcript, provider and plan cannot forge persisted identity", async () => {
  const f = fixture();
  const r = await f.handler(
    upload({
      user_id: OTHER,
      transcript: "FORGED",
      provider: "attacker",
      plan: "pro",
      voice_limit: 99999,
    }),
  );
  equal(r.status, 200);
  equal(f.state.saved.length, 1);
  const saved = f.state.saved[0];
  equal(saved.business_id, BUSINESS);
  equal(saved.user_id, USER);
  equal(saved.provider, "openai");
  assert(saved.transcript !== "FORGED");
  equal(f.state.clients.map((x) => x.key), [PUBLIC, SECRET]);
  assert(
    f.state.clients[0].options.global.headers.Authorization ===
      "Bearer session",
  );
});
Deno.test("100 restricted or malformed backend entitlements never call provider", async () => {
  const values = [
    { plan: "free", voice_limit: 50 },
    { plan: "basic", voice_limit: 50 },
    { plan: "pro", voice_limit: 0 },
    { plan: "pro", voice_limit: -1 },
    { plan: "pro", voice_limit: "NaN" },
    { plan: "pro", voice_limit: null },
    { plan: "pro", voice_limit: {} },
    { plan: "pro", voice_limit: true },
    { plan: "pro", voice_limit: 0.5 },
    { plan: "pro", voice_limit: 1e308 },
  ];
  for (let i = 0; i < 100; i++) {
    const f = fixture({ usage: values[i % values.length] });
    await noProvider(f, upload({ plan: "pro", voice_limit: 999 }), 403);
    equal(f.state.reservations, 0);
  }
});
Deno.test("restricted status is truthful and hides model/configuration", async () => {
  const f = fixture({ usage: { plan: "free", voice_limit: 0 } });
  const r = await noProvider(f, status(), 200);
  equal(await r.json(), {
    configured: false,
    model: null,
    plan_restricted: true,
  });
});
Deno.test("entitlement read failure or missing usage fails closed", async () => {
  for (const o of [{ usageError: true }, { usage: null }]) {
    await noProvider(fixture(o), upload(), 503);
  }
});
Deno.test("quota, authorization and reservation-service failures make no provider call", async () => {
  for (
    const [code, expected] of [["P0001", 429], ["42501", 403], [
      "XX000",
      503,
    ]] as const
  ) {
    const f = fixture({ budgetCode: code });
    await noProvider(f, upload(), expected);
    equal(f.state.reservations, 1);
  }
});
Deno.test("successful RPC with missing reservation proof fails closed", async () => {
  const f = fixture({ emptyReservation: true });
  await noProvider(f, upload(), 503);
});
Deno.test("100 simultaneous calls honor 10 mocked atomic quota reservations", async () => {
  const f = fixture({ slots: 10 });
  const results = await Promise.all(
    Array.from({ length: 100 }, () => f.handler(upload())),
  );
  equal(results.filter((x) => x.status === 200).length, 10);
  equal(results.filter((x) => x.status === 429).length, 90);
  equal(f.state.provider, 10);
  equal(f.state.saved.length, 10);
});
Deno.test("missing server storage credential is rejected before quota or billable work", async () => {
  const f = fixture({ env: { SUPABASE_SERVICE_ROLE_KEY: undefined } });
  await noProvider(f, upload(), 503);
  equal(f.state.reservations, 0);
});
Deno.test("missing provider key is rejected before quota", async () => {
  const f = fixture({ env: { OPENAI_API_KEY: undefined } });
  await noProvider(f, upload(), 503);
  equal(f.state.reservations, 0);
});
Deno.test("status requires storage readiness and never reveals credentials", async () => {
  for (const env of [{}, { SUPABASE_SERVICE_ROLE_KEY: undefined }]) {
    const f = fixture({ env });
    const r = await noProvider(f, status(), 200);
    const value = await r.text();
    assert(!value.includes(API) && !value.includes(SECRET));
    equal(
      JSON.parse(value).configured,
      env.SUPABASE_SERVICE_ROLE_KEY === undefined && Object.keys(env).length > 0
        ? false
        : true,
    );
  }
});
Deno.test("invalid credential maps fail closed rather than throwing JSON parse errors", async () => {
  for (const field of ["SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_SECRET_KEYS"]) {
    const env: Record<string, string | undefined> = {
      SUPABASE_ANON_KEY: field === "SUPABASE_PUBLISHABLE_KEYS"
        ? undefined
        : PUBLIC,
      SUPABASE_SERVICE_ROLE_KEY: field === "SUPABASE_SECRET_KEYS"
        ? undefined
        : SECRET,
      [field]: "not json",
    };
    await noProvider(fixture({ env }), upload(), 503);
  }
});
Deno.test("malformed and nonobject JSON body returns 400, not generic 500", async () => {
  for (const body of ["{", "null", "[]", "42"]) {
    const f = fixture();
    await noProvider(
      f,
      new Request("https://test.invalid", {
        method: "POST",
        headers: {
          Authorization: "Bearer session",
          "content-type": "application/json",
        },
        body,
      }),
      400,
    );
  }
});
Deno.test("non-string or malformed business field is rejected before membership", async () => {
  for (const business_id of [null, 42, {}, [BUSINESS], "bad"]) {
    const f = fixture();
    await noProvider(f, status({ business_id, action: "status" }), 400);
    equal(f.state.calls, ["auth"]);
  }
});
Deno.test("unknown JSON actions cannot activate transcription", async () => {
  await noProvider(
    fixture(),
    status({ business_id: BUSINESS, action: "transcribe", text: "forged" }),
    400,
  );
});
Deno.test("invalid multipart encoding and unsupported body types fail safely", async () => {
  for (const type of ["text/plain", "multipart/form-data; boundary=missing"]) {
    const f = fixture();
    await noProvider(
      f,
      new Request("https://test.invalid", {
        method: "POST",
        headers: { Authorization: "Bearer session", "content-type": type },
        body: "bad",
      }),
      type === "text/plain" ? 415 : 400,
    );
  }
});
Deno.test("oversized declared and streamed JSON bodies are bounded before parsing", async () => {
  for (const declared of [false, true]) {
    const f = fixture();
    const headers: Record<string, string> = {
      Authorization: "Bearer session",
      "content-type": "application/json",
    };
    if (declared) headers["content-length"] = "9000";
    await noProvider(
      f,
      new Request("https://test.invalid", {
        method: "POST",
        headers,
        body: "x".repeat(9000),
      }),
      413,
    );
  }
});
Deno.test("stalled request body is cancelled within deadline", async () => {
  let cancelled = false;
  const f = fixture({ bodyTimeoutMs: 10 });
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  await noProvider(
    f,
    new Request(
      "https://test.invalid",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer session",
          "content-type": "application/json",
        },
        body: stream,
        duplex: "half",
      } as RequestInit,
    ),
    408,
  );
  assert(cancelled);
});
for (
  const [title, opt, expected] of [
    ["missing audio", { noAudio: true }, 400],
    ["empty audio", { size: 0 }, 422],
    ["tiny audio", { size: 127 }, 422],
    ["oversized audio", { size: 10 * 1024 * 1024 + 1 }, 413],
    ["wrong extension", { name: "payload.html" }, 415],
    ["wrong mime", { mime: "text/html" }, 415],
    ["zero duration", { duration: 0 }, 400],
    ["negative duration", { duration: -1 }, 400],
    ["long duration", { duration: 121 }, 400],
    ["malformed duration", { duration: "NaN" }, 400],
  ] as const
) {
  Deno.test(title + " is rejected before provider/quota", async () => {
    const f = fixture();
    await noProvider(f, upload({}, opt), expected);
    equal(f.state.reservations, 0);
  });
}
for (
  const [name, mime] of [
    ["voice.webm", "audio/webm;codecs=opus"],
    ["voice.m4a", "audio/mp4"],
    ["voice.mp4", "video/mp4"],
    ["voice.wav", "audio/wav"],
    ["voice.mp3", "audio/mpeg"],
    ["voice.ogg", "audio/ogg"],
    ["voice.flac", "audio/flac"],
  ]
) {
  Deno.test(
    name + " preserves supported upload contract (not real codec validation)",
    async () => {
      const f = fixture();
      equal((await f.handler(upload({}, { name, mime }))).status, 200);
      equal(f.state.provider, 1);
    },
  );
}
Deno.test("prompt length is bounded and unapproved model cannot be selected", async () => {
  const f = fixture({
    env: { OPENAI_TRANSCRIPTION_MODEL: "arbitrary-expensive-model" },
  });
  equal(
    (await f.handler(upload({ prompt: "x".repeat(1000), model: "attacker" })))
      .status,
    200,
  );
  equal(f.state.uploads[0].get("prompt"), "x".repeat(300));
  equal(f.state.uploads[0].get("model"), "gpt-4o-transcribe");
});
for (const statusCode of [400, 401, 403, 413, 415, 422, 429, 500, 503]) {
  Deno.test(
    "provider HTTP " + statusCode + " is bounded and never silently retried",
    async () => {
      let calls = 0;
      const f = fixture({
        provider: (url, init, options) =>
          providerJson(url, init, {
            ...options,
            fetcher: async () => {
              calls++;
              return new Response("private provider diagnostic", {
                status: statusCode,
              });
            },
          }),
      });
      const r = await f.handler(upload());
      equal(r.status, statusCode === 429 ? 429 : 502);
      equal(calls, 1);
      equal(f.state.saved.length, 0);
      assert(!(await r.text()).includes("private provider diagnostic"));
    },
  );
}
Deno.test("provider network failure returns sanitized 502 without persistence", async () => {
  const f = fixture({
    provider: (url, init, options) =>
      providerJson(url, init, {
        ...options,
        fetcher: () => {
          throw new Error("private network details");
        },
      }),
  });
  equal((await f.handler(upload())).status, 502);
  equal(f.state.provider, 1);
  equal(f.state.saved.length, 0);
});
Deno.test("provider timeout cancels request and returns 504 without retry", async () => {
  let aborted = false;
  const f = fixture({
    provider: (url, init, options) =>
      providerJson(url, init, {
        ...options,
        timeoutMs: 10,
        fetcher: (_url, request) =>
          new Promise((_resolve, reject) =>
            request?.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            })
          ),
      }),
  });
  equal((await f.handler(upload())).status, 504);
  assert(aborted);
  equal(f.state.provider, 1);
  equal(f.state.saved.length, 0);
});
for (const body of ["not JSON", "null", "[]", "true"]) {
  Deno.test(
    "malformed provider response " + body + " cannot persist",
    async () => {
      const f = fixture({
        provider: (url, init, options) =>
          providerJson(url, init, {
            ...options,
            fetcher: async () => new Response(body),
          }),
      });
      equal((await f.handler(upload())).status, 502);
      equal(f.state.saved.length, 0);
    },
  );
}
for (const text of ["", " ", 42, null, "x".repeat(6001)]) {
  Deno.test(
    "unusable transcript " + String(text).slice(0, 12) + " cannot persist",
    async () => {
      const f = fixture({ text });
      equal((await f.handler(upload())).status, 422);
      equal(f.state.saved.length, 0);
    },
  );
}
Deno.test("provider oversized response cannot persist or leak content", async () => {
  const f = fixture({
    provider: (url, init, options) =>
      providerJson(url, init, {
        ...options,
        fetcher: async () => new Response("x".repeat(262145)),
      }),
  });
  equal((await f.handler(upload())).status, 502);
  equal(f.state.saved.length, 0);
});
for (
  const option of [{ saveError: true }, { saveThrow: true }, {
    missingID: true,
  }]
) {
  Deno.test(
    "storage failure " + JSON.stringify(option) +
      " reports uncertainty without replaying provider",
    async () => {
      const f = fixture(option);
      const r = await f.handler(upload());
      equal(r.status, 503);
      const result = await r.json();
      equal(result.code, "voice_storage_unconfirmed");
      assert(!result.transcript);
      assert(!JSON.stringify(result).includes("private"));
      equal(f.state.provider, 1);
      equal(f.state.saved.length, 1);
    },
  );
}
Deno.test("successful transcript is trimmed, attributed and returned with no-store", async () => {
  const f = fixture({ text: "  Invoice Alex $120  " });
  const r = await f.handler(upload());
  equal(r.status, 200);
  equal(r.headers.get("cache-control"), "no-store");
  equal((await r.json()).transcript, "Invoice Alex $120");
  equal(f.state.saved[0].transcript, "Invoice Alex $120");
  equal(f.state.saved[0].duration_seconds, 12);
  assert(
    f.state.calls.indexOf("reserve_ai_provider_attempt") <
      f.state.calls.indexOf("storage"),
  );
});
Deno.test("Supabase session network stall is aborted and fails before provider", async () => {
  let aborted = false, provider = 0;
  const handler = createTranscribeVoiceHandler({
    env: (key) => ({
      SUPABASE_URL: "https://test.invalid",
      SUPABASE_ANON_KEY: PUBLIC,
    }[key]),
    databaseTimeoutMs: 10,
    fetcher: (_resource, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("timeout"));
        })
      ),
    createClient: (_url, _key, options) => ({
      auth: {
        getUser: async () => {
          await options.global.fetch("https://test.invalid/auth/v1/user");
          return { data: null, error: null };
        },
      },
    }),
    provider: async () => {
      provider++;
      return { text: "unexpected" };
    },
  });
  equal((await handler(upload())).status, 503);
  assert(aborted);
  equal(provider, 0);
});
Deno.test("modern public/secret credential maps preserve server-only storage", async () => {
  const f = fixture({
    env: {
      SUPABASE_ANON_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLIC }),
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
    },
  });
  equal((await f.handler(upload())).status, 200);
  equal(f.state.clients.map((x) => x.key), [PUBLIC, SECRET]);
});
