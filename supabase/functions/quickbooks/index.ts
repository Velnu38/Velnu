import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAppEnvironment } from "../_shared/appEnvironment.ts";
import { fetchQuickBooksQueryPages } from "../_shared/quickbooksQuery.ts";

const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_ENVIRONMENT = resolveAppEnvironment(PROJECT_URL, Deno.env.get("FINVIANT_APP_BASE_URL") || Deno.env.get("VELNU_APP_URL"));
const APP_URL = APP_ENVIRONMENT?.baseUrl || "";
const INTUIT_ENVIRONMENT = Deno.env.get("INTUIT_ENVIRONMENT") === "production" ? "production" : "sandbox";
const CLIENT_ID = Deno.env.get("INTUIT_CLIENT_ID")?.trim() ?? "";
const CLIENT_SECRET = Deno.env.get("INTUIT_CLIENT_SECRET")?.trim() ?? "";
const ENCRYPTION_KEY = Deno.env.get("INTUIT_TOKEN_ENCRYPTION_KEY")?.trim() ?? "";
const CALLBACK = PROJECT_URL + "/functions/v1/quickbooks";
const ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting";
const API_BASE = INTUIT_ENVIRONMENT === "production"
  ? "https://quickbooks.api.intuit.com"
  : "https://sandbox-quickbooks.api.intuit.com";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, x-client-info, content-type",
  "cache-control": "no-store",
  "content-type": "application/json",
};
const result = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: cors });
const admin = createClient(PROJECT_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
function configured() {
  return Boolean(PROJECT_URL && SERVICE_KEY && CLIENT_ID && CLIENT_SECRET
    && /^[a-fA-F0-9]{64}$/.test(ENCRYPTION_KEY)
    && APP_URL.startsWith("https://"));
}
function redirectHome(status: "connected" | "error" | "cancelled") {
  if (!APP_URL) return result(503, { error: "Application environment is not configured." });
  const u = new URL(APP_URL);
  u.searchParams.set("quickbooks", status);
  return new Response(null, { status: 302, headers: {
    location: u.toString(), "cache-control": "no-store",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
  } });
}
function sha256(s: string) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
    .then(b => Array.from(new Uint8Array(b), n => n.toString(16).padStart(2, "0")).join(""));
}
async function encryptionKey() {
  if (!/^[a-fA-F0-9]{64}$/.test(ENCRYPTION_KEY)) throw new Error("Token encryption is not configured");
  const bytes = new Uint8Array(ENCRYPTION_KEY.match(/.{2}/g)!.map(hex => parseInt(hex, 16)));
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey();
  const content = new TextEncoder().encode(value);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, content));
  const packed = new Uint8Array(iv.length + encrypted.length);
  packed.set(iv);
  packed.set(encrypted, iv.length);
  return btoa(String.fromCharCode(...packed));
}
async function decrypt(value: string) {
  const packed = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (packed.length < 29) throw new Error("Invalid stored token");
  const iv = packed.slice(0, 12);
  const data = packed.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await encryptionKey(), data);
  return new TextDecoder().decode(plaintext);
}
function basicAuth() {
  return "Basic " + btoa(CLIENT_ID + ":" + CLIENT_SECRET);
}
async function tokenRequest(fields: Record<string, string>) {
  const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: { "authorization": basicAuth(), "accept": "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    console.error("Intuit token exchange failed:", response.status);
    throw new Error(response.status === 401 || response.status === 400
      ? "QuickBooks authorization expired or credentials were rejected. Reconnect the account."
      : "Could not reach Intuit to authorize QuickBooks.");
  }
  const payload = await response.json();
  if (!payload.access_token || !payload.refresh_token) throw new Error("Intuit did not return the expected credentials.");
  return payload as { access_token: string; refresh_token: string; expires_in: number };
}
async function checkUser(req: Request, businessId: string) {
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!bearer || !uuid.test(businessId)) return null;
  const { data, error } = await admin.auth.getUser(bearer);
  if (error || !data.user) return null;
  const { data: member, error: merror } = await admin.from("business_members")
    .select("role").eq("user_id", data.user.id).eq("business_id", businessId).maybeSingle();
  if (merror || !member || !["owner", "admin"].includes(member.role)) return null;
  return data.user.id as string;
}
async function callback(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (!configured() || !state || state.length > 250) return redirectHome("error");
  let consumed: any;
  try {
    const hash = await sha256(state);
    const { data, error } = await admin.from("quickbooks_oauth_states")
      .update({ used_at: new Date().toISOString() })
      .eq("state_hash", hash).is("used_at", null).gt("expires_at", new Date().toISOString())
      .select("business_id,initiated_by,environment").maybeSingle();
    if (error || !data || data.environment !== INTUIT_ENVIRONMENT) return redirectHome("error");
    consumed = data;
    if (url.searchParams.has("error")) return redirectHome("cancelled");
    const realmId = url.searchParams.get("realmId") || "";
    if (!code || !/^[0-9]+$/.test(realmId) || realmId.length > 80) return redirectHome("error");
    const { data: member } = await admin.from("business_members").select("role")
      .eq("business_id", consumed.business_id).eq("user_id", consumed.initiated_by).maybeSingle();
    if (!member || !["owner","admin"].includes(member.role)) return redirectHome("error");
    const { data: prior } = await admin.from("quickbooks_connections").select("realm_id")
      .eq("business_id", consumed.business_id).maybeSingle();
    if (prior && prior.realm_id !== realmId) return redirectHome("error");
    const token = await tokenRequest({
      grant_type: "authorization_code", code, redirect_uri: CALLBACK,
    });
    const { error: saveError } = await admin.from("quickbooks_connections").upsert({
      business_id: consumed.business_id,
      realm_id: realmId,
      environment: INTUIT_ENVIRONMENT,
      access_token_encrypted: await encrypt(token.access_token),
      refresh_token_encrypted: await encrypt(token.refresh_token),
      access_expires_at: new Date(Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000).toISOString(),
      connected_by: consumed.initiated_by,
      updated_at: new Date().toISOString(),
    }, { onConflict: "business_id" });
    if (saveError) throw saveError;
    return redirectHome("connected");
  } catch (e) {
    console.error("Intuit callback failed:", e instanceof Error ? e.name : "unknown");
    return redirectHome("error");
  }
}
async function getFreshAccess(businessId: string, connection: any): Promise<string> {
  if (new Date(connection.access_expires_at).getTime() - Date.now() > 5 * 60_000) {
    return decrypt(connection.access_token_encrypted);
  }
  const tokens = await tokenRequest({
    grant_type: "refresh_token", refresh_token: await decrypt(connection.refresh_token_encrypted),
  });
  const { error } = await admin.from("quickbooks_connections").update({
    access_token_encrypted: await encrypt(tokens.access_token),
    refresh_token_encrypted: await encrypt(tokens.refresh_token),
    access_expires_at: new Date(Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("business_id", businessId).eq("realm_id", connection.realm_id);
  if (error) throw error;
  return tokens.access_token;
}
type Kind = "Payment" | "SalesReceipt" | "Purchase";
async function loadTransactions(accessToken: string, realmId: string, kind: Kind, since: string) {
  return fetchQuickBooksQueryPages(async (startPosition, pageSize) => {
    const statement = "SELECT * FROM " + kind + " WHERE TxnDate >= '" + since + "' STARTPOSITION " + startPosition + " MAXRESULTS " + pageSize;
    const url = new URL(API_BASE + "/v3/company/" + encodeURIComponent(realmId) + "/query");
    url.searchParams.set("query", statement);
    url.searchParams.set("minorversion", "75");
    const response = await fetch(url, {
      headers: { authorization: "Bearer " + accessToken, accept: "application/json" },
      signal: AbortSignal.timeout(16000),
    });
    if (!response.ok) {
      console.error("Intuit query failed:", kind, response.status);
      throw new Error("QuickBooks could not fetch " + kind + " transactions (" + response.status + "). Try reconnecting or checking the account permissions.");
    }
    const body = await response.json();
    const queryResponse = body?.QueryResponse;
    const records = queryResponse?.[kind];
    return {
      records: Array.isArray(records) ? records : [],
      totalCount: queryResponse?.totalCount,
      startPosition: queryResponse?.startPosition,
    };
  });
}
function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000000) return null;
  return Number(n.toFixed(2));
}
function parseRows(businessId: string, realmId: string, kind: Kind, records: any[]) {
  const direction = kind === "Purchase" ? "expense" : "income";
  const name = kind === "Purchase" ? "QuickBooks purchase" : kind === "Payment" ? "QuickBooks payment" : "QuickBooks sales receipt";
  return records.flatMap(item => {
    const id = String(item.Id || "").slice(0,120);
    const date = String(item.TxnDate || "");
    const amount = money(item.TotalAmt);
    const currency = String(item.CurrencyRef?.value || "USD").toUpperCase();
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || amount === null || !/^[A-Z]{3}$/.test(currency)) return [];
    const ref = String(item.DocNumber || "").replace(/[^a-zA-Z0-9 ._-]/g, "").slice(0,70);
    const description = name + (ref ? " #" + ref : "");
    const updated = item.MetaData?.LastUpdatedTime && !Number.isNaN(Date.parse(item.MetaData.LastUpdatedTime))
      ? new Date(item.MetaData.LastUpdatedTime).toISOString() : null;
    return [{
      business_id: businessId, realm_id: realmId, source_type: kind, source_id: id,
      txn_date: date, direction, amount, currency, description, source_updated_at: updated,
      last_seen_at: new Date().toISOString(),
    }];
  });
}
async function handleSync(businessId: string, connection: any) {
  if (connection.environment !== INTUIT_ENVIRONMENT) {
    return result(409, { error: "This QuickBooks connection was created in a different environment. Reconnect in the current environment." });
  }
  const token = await getFreshAccess(businessId, connection);
  const since = new Date(Date.now() - 89 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  let count = 0;
  let limited = false;
  for (const kind of ["Payment","SalesReceipt","Purchase"] as Kind[]) {
    const page = await loadTransactions(token, connection.realm_id, kind, since);
    limited = limited || page.limited;
    const parsed = parseRows(businessId, connection.realm_id, kind, page.records);
    if (parsed.length) {
      const { error } = await admin.from("quickbooks_transactions").upsert(parsed, {
        onConflict: "business_id,realm_id,source_type,source_id",
      });
      if (error) throw error;
    }
    count += parsed.length;
  }
  const completedAt = new Date().toISOString();
  const { error } = await admin.from("quickbooks_connections").update({
    last_sync_at: completedAt, last_sync_count: count, updated_at: completedAt,
  }).eq("business_id", businessId);
  if (error) throw error;
  return result(200, {
    success: true, rows_processed: count, last_sync_at: completedAt,
    limited, since, read_only: true,
  });
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") return callback(req);
  if (req.method !== "POST") return result(405, { error: "Method not allowed" });
  try {
    if (!PROJECT_URL || !SERVICE_KEY) return result(503, { error: "Server integration is unavailable." });
    let input: any;
    try { input = await req.json(); } catch { return result(400, { error: "Invalid request." }); }
    const action = String(input?.action || "");
    const businessId = String(input?.business_id || "");
    const userId = await checkUser(req, businessId);
    if (!userId) return result(403, { error: "Only a business owner or administrator can manage QuickBooks." });
    // Never call Intuit for an account without an activated paid entitlement.
    // Plan preferences and add-on interests alone never grant access.
    const scopedClient = createClient(PROJECT_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: usage, error: usageError } = await scopedClient.rpc("get_plan_usage", { target_business_id: businessId });
    if (usageError || !usage) return result(503, { error: "Unable to verify integration entitlement." });
    if (usage.plan !== "pro") {
      if (action === "status") return result(200, {
        configured: false, connected: false, environment: INTUIT_ENVIRONMENT,
        company_id: null, connection_environment: null, last_sync_at: null, last_sync_count: 0,
        callback_url: CALLBACK, plan_restricted: true,
      });
      if (action === "connect" || action === "sync")
        return result(403, { error: "QuickBooks import is a paid integration and is not available on Free." });
      // Allow disconnect to remove previously linked data even after a plan downgrade.
    }
    const { data: connection, error: connectionError } = await admin.from("quickbooks_connections")
      .select("business_id,realm_id,environment,access_token_encrypted,refresh_token_encrypted,access_expires_at,last_sync_at,last_sync_count")
      .eq("business_id", businessId).maybeSingle();
    if (connectionError) throw connectionError;
    if (action === "status") {
      return result(200, {
        configured: configured(), connected: Boolean(connection), environment: INTUIT_ENVIRONMENT,
        company_id: connection?.realm_id ?? null, connection_environment: connection?.environment ?? null,
        last_sync_at: connection?.last_sync_at ?? null, last_sync_count: connection?.last_sync_count ?? 0,
        callback_url: CALLBACK,
      });
    }
    if (action === "connect") {
      if (!configured()) return result(503, { error: "Intuit developer credentials and encrypted token storage need setup by Velnu's administrator." });
      if (connection) return result(409, { error: "QuickBooks is already connected. Disconnect it before connecting another company." });
      if (input?.acknowledged_extra_costs !== true) return result(400, { error: "Please acknowledge the separate QuickBooks subscription and fee notice." });
      const state = crypto.randomUUID() + "." + crypto.randomUUID();
      const { error } = await admin.from("quickbooks_oauth_states").insert({
        state_hash: await sha256(state), business_id: businessId, initiated_by: userId,
        environment: INTUIT_ENVIRONMENT, expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
      });
      if (error) throw error;
      const auth = new URL("https://appcenter.intuit.com/connect/oauth2");
      auth.searchParams.set("client_id", CLIENT_ID);
      auth.searchParams.set("response_type", "code");
      auth.searchParams.set("scope", ACCOUNTING_SCOPE);
      auth.searchParams.set("redirect_uri", CALLBACK);
      auth.searchParams.set("state", state);
      return result(200, { authorization_url: auth.toString(), expires_in: 600 });
    }
    if (action === "disconnect") {
      if (!connection) return result(200, { disconnected: true });
      if (input?.confirm_delete_imported_data !== true) return result(400, { error: "You must confirm removal of the imported QuickBooks transactions." });
      const { error: remove } = await admin.from("quickbooks_transactions").delete().eq("business_id", businessId);
      if (remove) throw remove;
      const { error: deleteError } = await admin.from("quickbooks_connections").delete().eq("business_id", businessId);
      if (deleteError) throw deleteError;
      return result(200, { disconnected: true });
    }
    if (action === "sync") {
      if (!configured()) return result(503, { error: "Intuit credentials are not configured." });
      if (!connection) return result(409, { error: "Connect a QuickBooks company first." });
      if (connection.last_sync_at && Date.now() - new Date(connection.last_sync_at).getTime() < 120000) {
        return result(429, { error: "QuickBooks was synced recently. Please try again after two minutes." });
      }
      return await handleSync(businessId, connection);
    }
    return result(400, { error: "Unknown QuickBooks action." });
  } catch (e) {
    console.error("QuickBooks integration error:", e instanceof Error ? e.name : "unknown");
    return result(500, { error: e instanceof Error ? e.message : "QuickBooks integration encountered a problem." });
  }
});
