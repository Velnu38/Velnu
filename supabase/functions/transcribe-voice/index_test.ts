import {
  createTranscribeVoiceHandler,
  transcribeVoiceHandler as handle,
} from "./handler.ts";
import { ProviderRequestError } from "../_shared/providerRequest.ts";

const business = "11111111-1111-4111-8111-111111111111";
const foreignBusiness = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const receipt = "44444444-4444-4444-8444-444444444444";
const base = "https://voice-test.invalid";
const secret = "server-only-test-secret";
const providerKey = "sk-mocked-not-a-real-openai-key";
const maxAudio = 10 * 1024 * 1024;
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
function recording(
  options: {
    business?: string;
    name?: string;
    type?: string;
    size?: number;
    duration?: string;
    extras?: Record<string, string>;
  } = {},
) {
  const form = new FormData();
  form.set("business_id", options.business ?? business);
  form.set(
    "audio",
    new File(
      [new Uint8Array(options.size ?? 256)],
      options.name ?? "speech.webm",
      {
        type: options.type ?? "audio/webm",
      },
    ),
  );
  if (options.duration !== undefined) {
    form.set("duration_seconds", options.duration);
  }
  for (const [key, value] of Object.entries(options.extras ?? {})) {
    form.set(key, value);
  }
  return new Request(base + "/functions/v1/transcribe-voice", {
    method: "POST",
    headers: { authorization: "Bearer subscriber-test-token" },
    body: form,
  });
}
function status(body: unknown = { business_id: business, action: "status" }) {
  return new Request(base, {
    method: "POST",
    headers: {
      authorization: "Bearer subscriber-test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
type Options = {
  expired?: boolean;
  noMember?: boolean;
  memberError?: boolean;
  plan?: string;
  voiceLimit?: unknown;
  usageError?: boolean;
  budgetError?: string;
  missingReservation?: boolean;
  available?: number;
  providerStatus?: number;
  providerNetwork?: boolean;
  invalidProviderJson?: boolean;
  providerPayload?: unknown;
  saveError?: boolean;
  noReceipt?: boolean;
  storageNetwork?: boolean;
  env?: Record<string, string | undefined>;
};
type State = {
  calls: string[];
  providerCalls: number;
  reservations: number;
  writes: Record<string, unknown>[];
  remaining: number;
};
// Exercise the real Supabase SDK and bounded provider helper at the HTTP boundary.
// Deno is deliberately run without --allow-net; every URL must match this fake.
async function mock(options: Options, run: (s: State) => Promise<void>) {
  const original = globalThis.fetch;
  const env: Record<string, string | undefined> = {
    SUPABASE_URL: base,
    SUPABASE_ANON_KEY: "publishable-test-key",
    SUPABASE_PUBLISHABLE_KEYS: undefined,
    SUPABASE_SERVICE_ROLE_KEY: secret,
    SUPABASE_SECRET_KEYS: undefined,
    OPENAI_API_KEY: providerKey,
    OPENAI_TRANSCRIPTION_MODEL: undefined,
    ...options.env,
  };
  const previous = new Map(Object.keys(env).map((k) => [k, Deno.env.get(k)]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  const s: State = {
    calls: [],
    providerCalls: 0,
    reservations: 0,
    writes: [],
    remaining: options.available ?? 50,
  };
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init), url = new URL(req.url);
    s.calls.push(req.method + " " + url.pathname);
    if (url.hostname === "api.openai.com") {
      s.providerCalls++;
      assert(req.headers.get("authorization") === "Bearer " + providerKey);
      assert(
        s.reservations >= s.providerCalls,
        "A provider call requires a reserved attempt",
      );
      const upload = await req.formData();
      assert(upload.get("file") instanceof File);
      assert(upload.get("response_format") === "json");
      assert(String(upload.get("prompt") ?? "").length <= 300);
      if (options.providerNetwork) {
        throw new TypeError("provider network failed: PRIVATE DETAIL");
      }
      if (options.invalidProviderJson) {
        return new Response("not-json: PRIVATE DETAIL");
      }
      return json(
        options.providerPayload ??
          { text: "  Invoice Taylor for faucet repair, $185.  " },
        options.providerStatus ?? 200,
      );
    }
    assert(url.origin === base, "Unexpected external URL: " + url.origin);
    const storage = url.pathname === "/rest/v1/voice_transcriptions";
    assert(
      req.headers.get("apikey") === (storage ? secret : "publishable-test-key"),
    );
    assert(
      req.headers.get("authorization") ===
        "Bearer " + (storage ? secret : "subscriber-test-token"),
      "Server storage must never inherit the subscriber authorization header",
    );
    if (url.pathname === "/auth/v1/user") {
      return options.expired
        ? json({ code: "bad_jwt", message: "expired PRIVATE DETAIL" }, 401)
        : json({
          id: actor,
          email: "subscriber@example.invalid",
          app_metadata: {},
          user_metadata: { business_id: foreignBusiness, plan: "pro" },
        });
    }
    if (url.pathname === "/rest/v1/business_members") {
      assert(url.searchParams.get("business_id") === "eq." + business);
      assert(url.searchParams.get("user_id") === "eq." + actor);
      if (options.memberError) {
        return json({ code: "XX000", message: "PRIVATE DETAIL" }, 500);
      }
      return json(options.noMember ? [] : [{ business_id: business }]);
    }
    if (url.pathname === "/rest/v1/rpc/get_plan_usage") {
      assert((await req.json()).target_business_id === business);
      return options.usageError
        ? json({ code: "XX000", message: "PRIVATE DETAIL" }, 500)
        : json({
          plan: options.plan ?? "pro",
          voice_limit: options.voiceLimit === undefined
            ? 50
            : options.voiceLimit,
        });
    }
    if (url.pathname === "/rest/v1/rpc/reserve_ai_provider_attempt") {
      const body = await req.json();
      assert(
        body.p_business_id === business && body.p_kind === "transcription",
      );
      if (options.missingReservation) return json(null);
      if (options.budgetError) {
        return json(
          { code: options.budgetError, message: "PRIVATE DETAIL" },
          400,
        );
      }
      if (s.remaining <= 0) {
        return json(
          { code: "P0001", message: "AI_ATTEMPT_BUDGET_EXHAUSTED" },
          400,
        );
      }
      s.remaining--;
      s.reservations++;
      return json({ reserved: true, remaining: s.remaining });
    }
    if (storage) {
      assert(req.method === "POST", "Endpoint may only insert a transcript");
      s.writes.push(await req.json());
      if (options.storageNetwork) throw new TypeError("storage PRIVATE DETAIL");
      return options.saveError
        ? json({ code: "23503", message: "PRIVATE DETAIL" }, 400)
        : json(options.noReceipt ? {} : { id: receipt });
    }
    throw new Error("Unexpected database route: " + url.pathname);
  };
  try {
    await run(s);
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}
async function rejected(
  req: Request,
  expected: number,
  s: State,
  handler = handle,
) {
  const response = await handler(req);
  assert(
    response.status === expected,
    `Expected ${expected}, got ${response.status}: ${await response.clone()
      .text()}`,
  );
  const body = await response.json();
  assert(
    !body.transcript && !body.transcription_id,
    "Failure must not return a success receipt",
  );
  const text = JSON.stringify(body);
  for (const sensitive of [secret, providerKey, "PRIVATE DETAIL"]) {
    assert(!text.includes(sensitive));
  }
  assert(response.headers.get("cache-control") === "no-store");
  if (s.reservations === 0) {
    assert(s.providerCalls === 0 && s.writes.length === 0);
  }
}

for (const authorization of [undefined, "", "Basic xyz", "Bearer "]) {
  Deno.test(
    "reject unauthenticated header: " + String(authorization),
    () =>
      mock({}, async (s) => {
        const req = recording();
        if (authorization === undefined) req.headers.delete("authorization");
        else req.headers.set("authorization", authorization);
        await rejected(req, 401, s);
        assert(s.calls.length === 0);
      }),
  );
}
Deno.test("expired or forged session is rejected by verified Auth", () =>
  mock({ expired: true }, async (s) => {
    await rejected(recording(), 401, s);
    assert(s.calls.length === 1);
  }));
Deno.test("nonmember and forged JWT user metadata cannot authorize a business", () =>
  mock({ noMember: true }, (s) => rejected(recording(), 403, s)));
Deno.test("membership lookup failure fails closed", () =>
  mock({ memberError: true }, (s) => rejected(recording(), 403, s)));
Deno.test("business identifier must be a UUID", () =>
  mock({}, (s) => rejected(recording({ business: "x' OR 1=1 --" }), 400, s)));
Deno.test("cross-tenant business identifier is looked up against the authenticated actor", () =>
  mock({}, async (s) => {
    // The foreign ID is never queried with privileged credentials.
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const req = new Request(input, init), url = new URL(req.url);
      if (url.pathname.endsWith("/business_members")) {
        assert(req.headers.get("apikey") === "publishable-test-key");
        assert(url.searchParams.get("business_id") === "eq." + foreignBusiness);
        assert(url.searchParams.get("user_id") === "eq." + actor);
        return Promise.resolve(json([]));
      }
      return original(input, init);
    };
    await rejected(recording({ business: foreignBusiness }), 403, s);
  }));
for (
  const [plan, voiceLimit] of [
    ["free", 0],
    ["free", 50],
    ["pro", 0],
    ["pro", -1],
    ["pro", null],
    ["pro", "invalid"],
  ] as const
) {
  Deno.test(`deny unactivated entitlement ${plan}/${voiceLimit}`, () =>
    mock({ plan, voiceLimit }, (s) => rejected(recording(), 403, s)));
}
Deno.test("entitlement lookup failure does not call the provider", () =>
  mock({ usageError: true }, (s) => rejected(recording(), 503, s)));
Deno.test("Free status is restricted and exposes no model or key", () =>
  mock({ plan: "free" }, async (s) => {
    const res = await handle(status());
    assert(res.status === 200);
    const body = await res.json();
    assert(
      body.configured === false && body.model === null &&
        body.plan_restricted === true,
    );
    assert(
      s.reservations === 0 && s.providerCalls === 0 && s.writes.length === 0,
    );
  }));
Deno.test("Pro status is authenticated and does not spend quota", () =>
  mock({}, async (s) => {
    const res = await handle(status());
    assert(res.status === 200);
    const body = await res.json();
    assert(body.configured === true && body.model === "gpt-4o-transcribe");
    assert(!JSON.stringify(body).includes(providerKey));
    assert(s.reservations === 0);
  }));
for (const code of ["42501", "P0001", "XX000"]) {
  Deno.test(
    "failed attempt reservation prevents provider call: " + code,
    () =>
      mock({ budgetError: code }, (s) =>
        rejected(
          recording(),
          code === "42501" ? 403 : code === "P0001" ? 429 : 503,
          s,
        )),
  );
}
Deno.test("exhausted monthly or minute allowance is 429", () =>
  mock({ available: 0 }, (s) => rejected(recording(), 429, s)));
Deno.test("missing reservation receipt fails closed before a provider attempt", () =>
  mock({ missingReservation: true }, (s) => rejected(recording(), 503, s)));
Deno.test("simultaneous endpoint calls respect one remaining mocked reservation", () =>
  mock({ available: 1 }, async (s) => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => handle(recording())),
    );
    assert(responses.filter((r) => r.status === 200).length === 1);
    assert(responses.filter((r) => r.status === 429).length === 19);
    assert(
      s.providerCalls === 1 && s.reservations === 1 && s.writes.length === 1,
    );
    await Promise.all(responses.map((r) => r.arrayBuffer()));
  }));
Deno.test("unknown JSON action does not invoke transcription", () =>
  mock(
    {},
    (s) =>
      rejected(
        status({
          business_id: business,
          action: "store",
          transcript: "forged",
        }),
        400,
        s,
      ),
  ));
Deno.test("malformed JSON is a client error", () =>
  mock({}, async (s) => {
    const req = status();
    await rejected(new Request(req, { body: "{" }), 400, s);
  }));
Deno.test("unsupported body type is a client error", () =>
  mock({}, (s) =>
    rejected(
      new Request(base, {
        method: "POST",
        headers: {
          authorization: "Bearer subscriber-test-token",
          "content-type": "text/plain",
        },
        body: "malformed",
      }),
      415,
      s,
    )));
Deno.test("malformed multipart is a client error", () =>
  mock({}, (s) =>
    rejected(
      new Request(base, {
        method: "POST",
        headers: {
          authorization: "Bearer subscriber-test-token",
          "content-type": "multipart/form-data; boundary=absent",
        },
        body: "malformed",
      }),
      400,
      s,
    )));
Deno.test("missing audio is rejected without reserving quota", () =>
  mock({}, (s) => {
    const form = new FormData();
    form.set("business_id", business);
    return rejected(
      new Request(base, {
        method: "POST",
        headers: { authorization: "Bearer subscriber-test-token" },
        body: form,
      }),
      400,
      s,
    );
  }));
for (const [size, expected] of [[0, 422], [127, 422], [maxAudio + 1, 413]]) {
  Deno.test(
    "audio byte boundary " + size,
    () => mock({}, (s) => rejected(recording({ size }), expected, s)),
  );
}
for (
  const [name, type] of [["speech.exe", "audio/webm"], [
    "speech.webm",
    "text/html",
  ]]
) {
  Deno.test(
    "unsupported audio " + name + "/" + type,
    () => mock({}, (s) => rejected(recording({ name, type }), 415, s)),
  );
}
for (const duration of ["0", "-1", "121", "NaN", "Infinity"]) {
  Deno.test(
    "invalid duration " + duration,
    () => mock({}, (s) => rejected(recording({ duration }), 400, s)),
  );
}
for (
  const options of [
    { providerStatus: 401 },
    { providerStatus: 429 },
    { providerStatus: 500 },
    { providerNetwork: true },
    { invalidProviderJson: true },
    { providerPayload: [] },
    { providerPayload: { text: "x".repeat(270000) } },
  ]
) {
  Deno.test(
    "provider failure is bounded and never stored: " +
      JSON.stringify(options).slice(0, 100),
    () =>
      mock(options, async (s) => {
        await rejected(
          recording(),
          options.providerStatus === 429 ? 429 : 502,
          s,
        );
        assert(
          s.reservations === 1 && s.providerCalls === 1 &&
            s.writes.length === 0,
          "No retry or budget refund after an uncertain attempt",
        );
      }),
  );
}
Deno.test("provider timeout is 504 and not retried", () =>
  mock({}, async (s) => {
    let calls = 0;
    const handler = createTranscribeVoiceHandler(async () => {
      calls++;
      throw new ProviderRequestError("timeout");
    });
    await rejected(recording(), 504, s, handler);
    assert(calls === 1 && s.reservations === 1 && s.writes.length === 0);
  }));
for (
  const providerPayload of [{ text: "" }, { text: "  " }, { text: 123 }, {}, {
    text: "x".repeat(6001),
  }]
) {
  Deno.test(
    "unusable transcript is rejected: " +
      JSON.stringify(providerPayload).slice(0, 80),
    () =>
      mock({ providerPayload }, async (s) => {
        await rejected(recording(), 422, s);
        assert(s.writes.length === 0 && s.reservations === 1);
      }),
  );
}
for (
  const options of [{ saveError: true }, { noReceipt: true }, {
    storageNetwork: true,
  }]
) {
  Deno.test(
    "storage failure never claims success: " + JSON.stringify(options),
    () =>
      mock(options, async (s) => {
        await rejected(recording(), 503, s);
        assert(s.providerCalls === 1 && s.writes.length === 1);
      }),
  );
}
Deno.test("missing server storage credential fails before spending provider quota", () =>
  mock({ env: { SUPABASE_SERVICE_ROLE_KEY: undefined } }, async (s) => {
    await rejected(recording(), 503, s);
    assert(s.reservations === 0 && s.providerCalls === 0);
  }));
Deno.test("missing OpenAI credential fails before quota reservation", () =>
  mock(
    { env: { OPENAI_API_KEY: undefined } },
    (s) => rejected(recording(), 503, s),
  ));
Deno.test("malformed server credential map fails without a provider call", () =>
  mock({
    env: { SUPABASE_SERVICE_ROLE_KEY: undefined, SUPABASE_SECRET_KEYS: "{" },
  }, async (s) => {
    await rejected(recording(), 503, s);
    assert(s.reservations === 0 && s.providerCalls === 0);
  }));
Deno.test("declared oversized upload is rejected before parsing", () =>
  mock({}, async (s) => {
    const req = recording();
    req.headers.set("content-length", String(maxAudio * 2));
    await rejected(req, 413, s);
  }));
Deno.test("chunked oversized upload is canceled before parsing or quota", () =>
  mock({}, async (s) => {
    let pulls = 0, canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(1024 * 1024));
        if (pulls === 20) controller.close();
      },
      cancel() {
        canceled = true;
      },
    });
    const req = new Request(base, {
      method: "POST",
      headers: {
        authorization: "Bearer subscriber-test-token",
        "content-type": "multipart/form-data; boundary=test",
      },
      body: stream,
    });
    await rejected(req, 413, s);
    assert(
      canceled && pulls < 20,
      "Stop reading as soon as the byte limit is crossed",
    );
  }));
Deno.test("canonical server transcript and actor ignore forged multipart fields", () =>
  mock({}, async (s) => {
    const res = await handle(recording({
      duration: "12.5",
      extras: {
        user_id: foreignBusiness,
        transcript: "forged",
        provider: "forged",
        model: "forged",
        prompt: "x".repeat(600),
      },
    }));
    assert(res.status === 200);
    const body = await res.json();
    assert(
      body.transcription_id === receipt &&
        body.transcript === "Invoice Taylor for faucet repair, $185.",
    );
    assert(
      s.writes.length === 1 && s.writes[0].business_id === business &&
        s.writes[0].user_id === actor,
    );
    assert(
      s.writes[0].provider === "openai" &&
        s.writes[0].model === "gpt-4o-transcribe",
    );
    assert(
      s.writes[0].transcript === body.transcript &&
        s.writes[0].duration_seconds === 12.5,
    );
  }));
for (
  const [name, type] of [
    ["speech.webm", "audio/webm;codecs=opus"],
    ["speech.m4a", "audio/mp4"],
    ["speech.mp4", "video/mp4"],
    ["speech.wav", "audio/wav"],
    ["speech.mp3", "audio/mpeg"],
  ]
) {
  Deno.test(
    "preserve supported mobile/audio format " + type,
    () =>
      mock({}, async (s) => {
        const res = await handle(
          recording({ name, type, size: 128, duration: "120" }),
        );
        assert(res.status === 200);
        await res.arrayBuffer();
        assert(s.writes.length === 1);
      }),
  );
}
Deno.test("OPTIONS and unsupported methods never touch external services", () =>
  mock({}, async (s) => {
    assert(
      (await handle(new Request(base, { method: "OPTIONS" }))).status === 200,
    );
    assert((await handle(new Request(base))).status === 405);
    assert(s.calls.length === 0);
  }));
