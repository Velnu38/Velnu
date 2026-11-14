import { readLimitedRequest } from "../_shared/signedEvents.ts";
// Dependencies are injected so authorization, validation and provider failures are testable without sending mail.
export interface TeamDependencies {
  authorize: (
    authorization: string,
  ) => Promise<{
    reserve: (
      args: Record<string, unknown>,
    ) => Promise<{ data: any; error: any }>;
  } | null>;
  send: (
    email: string,
    url: string,
    name: string,
    id: string,
  ) => Promise<boolean>;
  origin: string;
  allowedOrigins: readonly string[];
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function teamHandler(deps: TeamDependencies) {
  return async (req: Request) => {
    const origin = req.headers.get("origin");
    const headers = {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin":
        origin && deps.allowedOrigins.includes(origin) ? origin : deps.origin,
      "access-control-allow-headers":
        "authorization,apikey,content-type,x-client-info",
      "access-control-allow-methods": "POST, OPTIONS",
      vary: "Origin",
    };
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers });
    if (origin && !deps.allowedOrigins.includes(origin))
      return reply(403, { error: "App address not authorized." });
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST")
      return reply(405, { error: "Method not allowed." });
    try {
      const caller = await deps.authorize(
        req.headers.get("authorization") || "",
      );
      if (!caller)
        return reply(401, { error: "Sign in to manage invitations." });
      const text = await readLimitedRequest(req, 8192);
      if (text.length > 8192)
        return reply(413, { error: "Request too large." });
      const input = JSON.parse(text);
      if (
        !uuid.test(input.business_id) ||
        typeof input.email !== "string" ||
        input.email.length > 254 ||
        !["office", "technician", "viewer"].includes(input.role) ||
        !Array.isArray(input.modules) ||
        input.modules.some(
          (x: unknown) =>
            !["calendar", "jobs", "billing", "finances"].includes(String(x)),
        ) ||
        (input.replace_id && !uuid.test(input.replace_id))
      )
        return reply(400, {
          error: "Check the email, role and access selections.",
        });
      const token = Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        (v) => v.toString(16).padStart(2, "0"),
      ).join("");
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(token),
      );
      const hash = Array.from(new Uint8Array(digest), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
      // The caller-scoped RPC checks primary ownership and reserves a seat under a business row lock.
      const { data, error } = await caller.reserve({
        p_business: input.business_id,
        p_email: input.email,
        p_role: input.role,
        p_modules: input.modules,
        p_hash: hash,
        p_replace: input.replace_id || null,
      });
      if (error)
        return reply(error.code === "42501" ? 403 : 409, {
          error: error.message || "Invitation could not be created.",
        });
      const url = deps.origin + "/auth?invite=" + token;
      let sent = false;
      try {
        sent = await deps.send(data.email, url, data.business_name, data.id);
      } catch {}
      console.info(
        JSON.stringify({
          service: "team-management",
          event: "invitation_created",
          invitation_id: data.id,
          email_status: sent ? "accepted" : "unconfirmed",
        }),
      );
      return reply(200, {
        url,
        expires_at: data.expires_at,
        email_status: sent ? "accepted" : "unconfirmed",
      });
    } catch {
      return reply(400, {
        error:
          "Invitation could not be created. Refresh the team list before trying again.",
      });
    }
  };
}
