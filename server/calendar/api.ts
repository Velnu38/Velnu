import { connectedAgenda, externalRange } from './external.js';
import { randomUUID } from "node:crypto";
import { CodeChallengeMethod } from "google-auth-library";
import { actor, body, checkOrigin, errorResponse, json, uuid } from "./http.js";
import { transaction, appOrigin, enqueue } from "./db.js";
import {
  digest,
  randomSecret,
  encrypt,
  decrypt,
  equalSecret,
} from "./crypto.js";
import { googleAuth, googleScopes } from "./google.js";
import { microsoftAuth, outlookScopes, outlookRedirect } from "./outlook.js";
import { provider } from "./providers.js";
import { CalendarError, classify } from "./errors.js";
import type { Integration, Provider, Tokens, Envelope } from "./types.js";
const providerName = (v: unknown): Provider => {
  if (v !== "google" && v !== "outlook")
    throw new CalendarError("invalid_provider", false, 0, 400);
  return v;
};
const cookieName = (p: Provider) => `__Host-fv-calendar-${p}`;
const cookie = (p: Provider, value: string, age = 600) =>
  `${cookieName(p)}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const safeFields =
  "id,provider,email,calendar_id,calendar_name,auto_sync,state,last_synced_at,last_error";

async function callback(req: Request, url: URL) {
  const p = providerName(url.searchParams.get("provider")),
    state = url.searchParams.get("state") || "";
  const browser =
    (req.headers.get("cookie") || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${cookieName(p)}=`))
      ?.slice(cookieName(p).length + 1) || "";
  if (state.length < 32 || !browser)
    throw new CalendarError("invalid_oauth_state", false, 0, 400);
  // Consume once only after matching the HttpOnly browser nonce and provider.
  const oauth = await transaction(async (db) => {
    const row = (
      await db.query(
        "select * from private.calendar_oauth_states where state_hash=$1 for update",
        [digest(state)],
      )
    ).rows[0];
    if (
      !row ||
      row.provider !== p ||
      new Date(row.expires_at).getTime() < Date.now() ||
      !equalSecret(row.browser_hash, digest(browser))
    )
      throw new CalendarError("invalid_oauth_state", false, 0, 400);
    await db.query(
      "delete from private.calendar_oauth_states where state_hash=$1",
      [digest(state)],
    );
    return row as {
      state_hash: string;
      business_id: string;
      user_id: string;
      verifier: Envelope;
    };
  });
  if (url.searchParams.has("error"))
    return new Response(null, {
      status: 303,
      headers: {
        Location: `${appOrigin()}/?view=settings&calendar=declined`,
        "Set-Cookie": cookie(p, "", 0),
        "Cache-Control": "no-store",
      },
    });
  const code = url.searchParams.get("code");
  if (!code) throw new CalendarError("missing_oauth_code", false, 0, 400);
  const verifier = decrypt<string>(oauth.verifier, oauth.state_hash);
  const tokens: Tokens = {};
  let accountId = "",
    email = "";
  if (p === "google") {
    const auth = googleAuth(),
      result = await auth.getToken({ code, codeVerifier: verifier });
    Object.assign(tokens, result.tokens);
    auth.setCredentials(result.tokens);
    const info = await auth.request<{
      sub: string;
      email: string;
      email_verified: boolean;
    }>({
      url: "https://openidconnect.googleapis.com/v1/userinfo",
      timeout: 10_000,
      retry: false,
    });
    if (!info.data.email_verified || !info.data.sub)
      throw new CalendarError("provider_identity_unavailable", false, 0, 400);
    accountId = info.data.sub;
    email = info.data.email;
    if (!tokens.refresh_token)
      throw new CalendarError("offline_access_not_granted", false, 0, 400);
  } else {
    const auth = microsoftAuth(tokens);
    const result = await auth.acquireTokenByCode({
      code,
      codeVerifier: verifier,
      redirectUri: outlookRedirect(),
      scopes: outlookScopes,
    });
    if (!result?.account)
      throw new CalendarError("provider_identity_unavailable", false, 0, 400);
    tokens.homeAccountId = result.account.homeAccountId;
    tokens.msalCache = auth.getTokenCache().serialize();
    accountId = result.account.homeAccountId;
    email = result.account.username;
  }
  await transaction(async (db) => {
    if (
      !(
        await db.query(
          "select 1 from public.business_members where business_id=$1 and user_id=$2 and 'calendar'=any(access_modules) and private.effective_plan(business_id)<>'free'",
          [oauth.business_id, oauth.user_id],
        )
      ).rowCount
    )
      throw new CalendarError("workspace_access_denied", false, 0, 403);
    // Serialize first-time/repeated callbacks as well as worker token refreshes.
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${oauth.business_id}:${oauth.user_id}:${p}`,
    ]);
    const prior = (
      await db.query(
        "select * from private.calendar_integrations where business_id=$1 and user_id=$2 and provider=$3 for update",
        [oauth.business_id, oauth.user_id, p],
      )
    ).rows[0] as Integration | undefined;
    if (
      prior &&
      prior.account_id !== accountId &&
      prior.state !== "disconnected"
    )
      throw new CalendarError(
        "disconnect_previous_account_first",
        false,
        0,
        409,
      );
    const id = prior?.id || randomUUID();
    // A disconnected account gets a fresh namespace so events from a different account cannot collide.
    if (prior?.state === "disconnected")
      await db.query(
        "delete from private.calendar_event_links where integration_id=$1",
        [id],
      );
    const keep = prior && prior.state !== "disconnected";
    await db.query(
      `insert into private.calendar_integrations(id,business_id,user_id,provider,account_id,email,credentials,calendar_id,calendar_name,auto_sync)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(id) do update set account_id=excluded.account_id,email=excluded.email,credentials=excluded.credentials,state='connected',last_error=null,calendar_id=excluded.calendar_id,calendar_name=excluded.calendar_name,auto_sync=excluded.auto_sync`,
      [
        id,
        oauth.business_id,
        oauth.user_id,
        p,
        accountId,
        email,
        encrypt(tokens, id),
        keep ? prior.calendar_id : "primary",
        keep ? prior.calendar_name : "Primary calendar",
        keep ? prior.auto_sync : false,
      ],
    );
    await enqueue(db, id);
  });
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${appOrigin()}/?view=settings&calendar=connected`,
      "Set-Cookie": cookie(p, "", 0),
      "Cache-Control": "no-store",
    },
  });
}
export async function calendarApi(req: Request): Promise<Response> {
  try {
    if (process.env.CALENDAR_SYNC_ENABLED !== "true")
      return json({ error: "calendar_setup_required" }, 503);
    const url = new URL(req.url),
      action = url.searchParams.get("action") || "list";
    if (action === "callback" && req.method === "GET")
      return await callback(req, url);
    if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method))
      return json({ error: "method_not_allowed" }, 405);
    if (req.method !== "GET") checkOrigin(req);
    const input =
      req.method === "GET"
        ? Object.fromEntries(url.searchParams)
        : await body(req);
    const bid = uuid(input.businessId),
      user = await actor(req, bid, !["disconnect", "list"].includes(action));
    if (action === "connect" && req.method === "POST") {
      const p = providerName(input.provider),
        state = randomSecret(),
        verifier = randomSecret(),
        browser = randomSecret(),
        stateHash = digest(state);
      await transaction(async (db) => {
        // Serialize rate-limit checks for concurrent connect requests by the same user.
        await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
          `calendar-oauth:${user.id}`,
        ]);
        await db.query(
          "delete from private.calendar_oauth_states where expires_at<now()",
        );
        const n = Number(
          (
            await db.query(
              "select count(*) as n from private.calendar_oauth_states where user_id=$1",
              [user.id],
            )
          ).rows[0].n,
        );
        if (n >= 5)
          throw new CalendarError("connection_attempt_limit", true, 600, 429);
        await db.query(
          "insert into private.calendar_oauth_states(state_hash,business_id,user_id,provider,browser_hash,verifier,expires_at) values($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')",
          [
            stateHash,
            bid,
            user.id,
            p,
            digest(browser),
            encrypt(verifier, stateHash),
          ],
        );
      });
      const challenge = Buffer.from(digest(verifier), "hex").toString(
        "base64url",
      );
      const authUrl =
        p === "google"
          ? googleAuth().generateAuthUrl({
              access_type: "offline",
              prompt: "consent",
              scope: googleScopes,
              state,
              code_challenge: challenge,
              code_challenge_method: CodeChallengeMethod.S256,
            })
          : await microsoftAuth().getAuthCodeUrl({
              scopes: outlookScopes,
              redirectUri: outlookRedirect(),
              state,
              codeChallenge: challenge,
              codeChallengeMethod: "S256",
              prompt: "select_account",
            });
      return json({ url: authUrl }, 200, { "Set-Cookie": cookie(p, browser) });
    }
    if (action === "list" && req.method === "GET")
      return await transaction(async (db) =>
        json({
          integrations: (
            await db.query(
              `select ${safeFields} from private.calendar_integrations where business_id=$1 and user_id=$2`,
              [bid, user.id],
            )
          ).rows,
        }),
      );
    if (action === 'events' && req.method === 'GET')
      return json(await connectedAgenda(bid, user.id, externalRange(input.startDay, input.endDay, input.timezone)));
    const id = uuid(input.integrationId);
    return await transaction(async (db) => {
      const integration = (
        await db.query(
          "select * from private.calendar_integrations where id=$1 and business_id=$2 and user_id=$3 for update",
          [id, bid, user.id],
        )
      ).rows[0] as Integration | undefined;
      if (!integration)
        throw new CalendarError("integration_not_found", false, 0, 404);
      try {
        if (req.method === "DELETE") {
          if (input.forget === true) {
            // Explicit escape hatch after revocation: tokens erased; remote remnants disclosed in UI.
            await db.query(
              "update private.calendar_integrations set state='disconnected',auto_sync=false,credentials=null,last_error='disconnected_remote_cleanup_required' where id=$1",
              [id],
            );
            await db.query(
              "delete from private.calendar_sync_queue where integration_id=$1",
              [id],
            );
          } else {
            await db.query(
              "update private.calendar_integrations set state='disconnecting',auto_sync=false where id=$1",
              [id],
            );
            await enqueue(db, id);
          }
          return json({ ok: true });
        }
        if (integration.state !== "connected")
          throw new CalendarError("reconnect_required", false, 0, 409);
        if (action === "retry" && req.method === "POST") {
          await enqueue(db, id);
          return json({ ok: true });
        }
        const svc = provider(db, integration);
        if (action === "calendars" && req.method === "GET")
          return json({ calendars: await svc.calendars() });
        if (req.method === "PATCH") {
          if (
            typeof input.autoSync !== "boolean" ||
            typeof input.calendarId !== "string"
          )
            throw new CalendarError("invalid_settings", false, 0, 400);
          const calendars = await svc.calendars();
          const calendar =
            input.calendarId === "primary"
              ? { id: "primary", name: "Primary calendar" }
              : calendars.find((c) => c.id === input.calendarId);
          if (!calendar)
            throw new CalendarError("calendar_not_writable", false, 0, 400);
          await db.query(
            "update private.calendar_integrations set auto_sync=$2,calendar_id=$3,calendar_name=$4,updated_at=now() where id=$1",
            [id, input.autoSync, calendar.id, calendar.name],
          );
          await enqueue(db, id);
          return json({ ok: true });
        }
        return json({ error: "method_not_allowed" }, 405);
      } catch (e) {
        const issue = classify(e);
        // Return rather than throw so a rotated token is committed even on a provider failure.
        if (issue.reason === "authorization_revoked")
          await db.query(
            "update private.calendar_integrations set state='reconnect_required',last_error=$2 where id=$1",
            [id, issue.reason],
          );
        return errorResponse(issue);
      }
    });
  } catch (e) {
    return errorResponse(e);
  }
}
