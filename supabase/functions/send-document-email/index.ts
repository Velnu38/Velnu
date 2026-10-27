import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://finviant.com",
  "https://www.finviant.com",
  "https://app.finviant.com",
  "https://velnu-git-feature-velnu-stage1-mbarone5-1747.vercel.app",
  "http://localhost:5173",
  "http://localhost",
  "capacitor://localhost",
]);

function cors(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  const allow = allowedOrigins.has(origin) ? origin : "https://finviant.com";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const respond = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: cors(req) });

function esc(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value: unknown) {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(n) ? n : 0);
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function customerName(customer: any) {
  return [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || customer?.company || "Customer";
}

function emailHtml(params: {
  businessName: string;
  recipientName: string;
  documentLabel: string;
  documentNumber: string;
  title?: string | null;
  total: number;
  approvalUrl: string;
  customerMessage?: string | null;
  scheduleImpactDays?: number;
}) {
  const schedule = params.scheduleImpactDays
    ? `<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#475467;padding-top:8px;">Schedule impact: ${params.scheduleImpactDays > 0 ? "+" : ""}${params.scheduleImpactDays} day${Math.abs(params.scheduleImpactDays) === 1 ? "" : "s"}</td></tr>`
    : "";
  const message = params.customerMessage
    ? `<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#475467;padding-top:14px;">${esc(params.customerMessage)}</td></tr>`
    : "";
  const title = params.title ? ` — ${esc(params.title)}` : "";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"></head><body style="margin:0;background-color:#f5f7fa;"><table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"><tr><td align="center" bgcolor="#f5f7fa" style="background-color:#f5f7fa;padding-top:32px;padding-right:16px;padding-bottom:32px;padding-left:16px;"><table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:600px;background-color:#ffffff;border-radius:16px;"><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#667085;padding-top:28px;padding-right:30px;padding-bottom:0;padding-left:30px;">${esc(params.businessName)}</td></tr><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:34px;font-weight:700;color:#101828;padding-top:8px;padding-right:30px;padding-bottom:0;padding-left:30px;">${esc(params.documentLabel)} ${esc(params.documentNumber)}${title}</td></tr><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#475467;padding-top:16px;padding-right:30px;padding-bottom:0;padding-left:30px;">Hi ${esc(params.recipientName)}, ${esc(params.businessName)} sent you a ${esc(params.documentLabel.toLowerCase())} to review.</td></tr>${message}<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#667085;padding-top:22px;padding-right:30px;padding-bottom:0;padding-left:30px;">Total</td></tr><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:38px;font-weight:700;color:#101828;padding-top:2px;padding-right:30px;padding-bottom:0;padding-left:30px;">${money(params.total)}</td></tr>${schedule}<tr><td align="left" style="padding-top:26px;padding-right:30px;padding-bottom:0;padding-left:30px;"><table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr><td bgcolor="#111827" style="background-color:#111827;border-radius:10px;"><a href="${esc(params.approvalUrl)}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;display:inline-block;padding-top:13px;padding-right:20px;padding-bottom:13px;padding-left:20px;">Review and respond</a></td></tr></table></td></tr><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#98a2b3;padding-top:28px;padding-right:30px;padding-bottom:30px;padding-left:30px;">This secure link is intended for you. If you were not expecting this message, contact ${esc(params.businessName)} directly.</td></tr></table></td></tr></table></body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return respond(req, 405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond(req, 401, { error: "Unauthorized" });

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return respond(req, 503, { error: "RESEND_API_KEY is not configured" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return respond(req, 401, { error: "Unauthorized" });

    const body = await req.json();
    const businessId = String(body.business_id ?? "");
    const documentType = String(body.document_type ?? "");
    const documentId = String(body.document_id ?? "");
    if (!businessId || !documentId || !["estimate", "change_order"].includes(documentType)) {
      return respond(req, 400, { error: "business_id, document_type and document_id are required" });
    }

    const { data: membership } = await supabase
      .from("business_members")
      .select("role")
      .eq("business_id", businessId)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!membership) return respond(req, 403, { error: "Forbidden" });
    if (!["owner", "admin", "office"].includes(membership.role)) return respond(req, 403, { error: "Only finance staff can email customer documents." });
    // Customer messaging is metered: never run a provider call for Free.
    const { data: usage, error: planError } = await supabase.rpc("get_plan_usage", { target_business_id: businessId });
    if (planError || !usage) return respond(req, 503, { error: "Unable to verify messaging entitlement" });
    if (usage.plan !== "pro" || Number(usage.email_limit ?? 0) <= 0)
      return respond(req, 403, { error: "Customer email and acceptance links require an activated paid plan." });

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id,name,email")
      .eq("id", businessId)
      .single();
    if (businessError || !business) return respond(req, 404, { error: "Business not found" });

    let doc: any = null;
    let label = "";
    let number = "";
    let title: string | null = null;
    let message: string | null = null;
    let scheduleImpactDays = 0;
    let customerId = "";

    if (documentType === "estimate") {
      const { data, error } = await supabase.from("estimates")
        .select("id,business_id,customer_id,estimate_number,status,total,customer_message")
        .eq("id", documentId).eq("business_id", businessId).maybeSingle();
      if (error) return respond(req, 500, { error: "Failed to load estimate" });
      if (!data) return respond(req, 404, { error: "Estimate not found" });
      if (["converted", "expired"].includes(data.status)) return respond(req, 409, { error: "This estimate cannot be sent" });
      doc = data; label = "Estimate"; number = data.estimate_number ?? ""; customerId = data.customer_id; message = data.customer_message;
    } else {
      const { data, error } = await supabase.from("change_orders")
        .select("id,business_id,customer_id,change_order_number,status,title,total,customer_message,schedule_impact_days")
        .eq("id", documentId).eq("business_id", businessId).maybeSingle();
      if (error) return respond(req, 500, { error: "Failed to load change order" });
      if (!data) return respond(req, 404, { error: "Change order not found" });
      if (data.status === "void") return respond(req, 409, { error: "This change order cannot be sent" });
      doc = data; label = "Change order"; number = data.change_order_number ?? ""; customerId = data.customer_id; title = data.title; message = data.customer_message; scheduleImpactDays = Number(data.schedule_impact_days ?? 0);
    }

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id,first_name,last_name,company,email")
      .eq("id", customerId).eq("business_id", businessId).maybeSingle();
    if (customerError) return respond(req, 500, { error: "Failed to load customer" });
    if (!customer) return respond(req, 404, { error: "Customer not found" });
    const recipient = String(customer.email ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return respond(req, 409, { error: "Customer does not have a valid email address" });

    const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
    const token = toBase64Url(bytes);
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
    const linkRow: any = {
      business_id: businessId,
      document_type: documentType,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by_user_id: userData.user.id,
    };
    if (documentType === "estimate") linkRow.estimate_id = documentId;
    else linkRow.change_order_id = documentId;

    const { data: link, error: linkError } = await supabase
      .from("document_approval_links")
      .insert(linkRow)
      .select("id")
      .single();
    if (linkError || !link) return respond(req, 500, { error: "Failed to create approval link" });

    const appBase = (Deno.env.get("FINVIANT_APP_BASE_URL") || "https://finviant.com").replace(/\/$/, "");
    const approvalUrl = `${appBase}/?approval=${encodeURIComponent(token)}`;
    const subject = `${business.name}: ${label} ${number || "ready for review"}`;
    const plain = `Hi ${customerName(customer)},\n\n${business.name} sent you a ${label.toLowerCase()} to review.\n${number ? `${label} ${number}\n` : ""}${title ? `${title}\n` : ""}Total: ${money(doc.total)}${scheduleImpactDays ? `\nSchedule impact: ${scheduleImpactDays > 0 ? "+" : ""}${scheduleImpactDays} day${Math.abs(scheduleImpactDays) === 1 ? "" : "s"}` : ""}\n\nReview and respond: ${approvalUrl}\n\nThis secure link expires in 14 days.`;

    const payload: any = {
      from: "Finviant Office <notifications@finviant.com>",
      to: [recipient],
      subject,
      html: emailHtml({ businessName: business.name, recipientName: customerName(customer), documentLabel: label, documentNumber: number, title, total: Number(doc.total ?? 0), approvalUrl, customerMessage: message, scheduleImpactDays }),
      text: plain,
      tags: [
        { name: "business", value: businessId },
        { name: "document_type", value: documentType },
      ],
    };
    if (business.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business.email)) payload.reply_to = [business.email];

    const resend = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `owedly-${documentType}-${documentId}-${link.id}` },
      body: JSON.stringify(payload),
    });

    if (!resend.ok) {
      const detail = await resend.text();
      console.error("Resend send failed", resend.status, detail);
      await supabase.from("document_approval_links").update({ revoked_at: new Date().toISOString() }).eq("id", link.id);
      await supabase.from("messages").insert({
        business_id: businessId,
        customer_id: customer.id,
        estimate_id: documentType === "estimate" ? documentId : null,
        change_order_id: documentType === "change_order" ? documentId : null,
        direction: "outbound",
        channel: "email",
        recipient,
        subject,
        body: plain,
        provider: "resend",
        status: "failed",
      });
      return respond(req, 502, { error: "Email delivery request failed" });
    }

    const sent = await resend.json();
    const now = new Date().toISOString();

    let revokeQuery = supabase.from("document_approval_links")
      .update({ revoked_at: now })
      .eq("business_id", businessId)
      .neq("id", link.id)
      .is("revoked_at", null);
    revokeQuery = documentType === "estimate" ? revokeQuery.eq("estimate_id", documentId) : revokeQuery.eq("change_order_id", documentId);
    await revokeQuery;

    if (documentType === "estimate") {
      await supabase.from("estimates").update({ status: "sent" }).eq("id", documentId).eq("business_id", businessId).in("status", ["draft", "sent", "declined"]);
    } else {
      await supabase.from("change_orders").update({ status: "sent", sent_at: now }).eq("id", documentId).eq("business_id", businessId).in("status", ["draft", "sent", "declined"]);
    }

    const { error: messageError } = await supabase.from("messages").insert({
      business_id: businessId,
      customer_id: customer.id,
      estimate_id: documentType === "estimate" ? documentId : null,
      change_order_id: documentType === "change_order" ? documentId : null,
      direction: "outbound",
      channel: "email",
      recipient,
      subject,
      body: plain,
      provider: "resend",
      provider_message_id: String(sent.id ?? "") || null,
      status: "sent",
      sent_at: now,
    });
    if (messageError) console.error("Failed to save message log", messageError);

    return respond(req, 200, { email_id: sent.id ?? null, recipient, approval_link_id: link.id, expires_at: expiresAt, status: "sent" });
  } catch (error) {
    console.error(error);
    return respond(req, 500, { error: "Unexpected server error" });
  }
});