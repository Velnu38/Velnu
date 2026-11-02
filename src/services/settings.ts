import { supabase } from "../lib/supabase";
import type { WorkspaceModule } from "../lib/workspaceAccess";
export type TeamRole = "office" | "technician" | "viewer";
export type TeamMember = {
  user_id: string;
  email: string;
  role: string;
  access_modules: WorkspaceModule[];
  primary_owner: boolean;
};
export type Invitation = {
  id: string;
  email: string;
  role: TeamRole;
  access_modules: WorkspaceModule[];
  expires_at: string;
};
export type TeamState = {
  seat_limit: number;
  pro: boolean;
  members: TeamMember[];
  invitations: Invitation[];
};
export type PaymentLink = {
  provider: "venmo" | "paypal" | "stripe" | "cashapp";
  url: string;
};
export type DocumentSettings = {
  default_tax_rate: number;
  pricing_adjustment_percent: number;
  payment_links: PaymentLink[];
  payment_instructions: string;
};
export const emptyDocumentSettings: DocumentSettings = {
  default_tax_rate: 0,
  pricing_adjustment_percent: 0,
  payment_links: [],
  payment_instructions: "",
};
export async function getTeam(businessId: string): Promise<TeamState> {
  const { data, error } = await supabase.rpc("get_team_settings", {
    p_business: businessId,
  });
  if (error) throw error;
  return data;
}
export async function manageMember(
  businessId: string,
  target: string,
  action: "update" | "remove" | "revoke",
  role?: TeamRole,
  modules?: WorkspaceModule[],
) {
  const { error } = await supabase.rpc("manage_team_member", {
    p_business: businessId,
    p_target: target,
    p_action: action,
    p_role: role ?? null,
    p_modules: modules ?? null,
  });
  if (error) throw error;
}
async function invoke<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = "This request could not be completed. Try again.";
    if (error.context instanceof Response) {
      try {
        message = (await error.context.json()).error || message;
      } catch {}
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
export function inviteMember(
  businessId: string,
  email: string,
  role: TeamRole,
  modules: WorkspaceModule[],
  replace?: string,
) {
  return invoke<{ url: string; email_status: string; expires_at: string }>(
    "team-management",
    { business_id: businessId, email, role, modules, replace_id: replace },
  );
}
export async function acceptInvitation(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const hash = Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const { data, error } = await supabase.rpc("accept_team_invitation", {
    p_hash: hash,
  });
  if (error) throw error;
  return data;
}
export async function getDocumentSettings(
  businessId: string,
): Promise<DocumentSettings> {
  const { data, error } = await supabase
    .from("business_settings")
    .select(
      "default_tax_rate,pricing_adjustment_percent,payment_links,payment_instructions",
    )
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...emptyDocumentSettings, ...data } : emptyDocumentSettings;
}
export async function saveDocumentSettings(
  businessId: string,
  value: DocumentSettings,
) {
  const { error } = await supabase
    .from("business_settings")
    .upsert(
      {
        business_id: businessId,
        ...value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id" },
    );
  if (error) throw error;
}
export type SubscriptionState = {
  active: boolean;
  status: string;
  cancel_at_period_end?: boolean;
  ends_at?: string | null;
  can_cancel?: boolean;
};
export function subscriptionAction(
  businessId: string,
  action: "status" | "cancel",
) {
  return invoke<SubscriptionState>("subscription-management", {
    business_id: businessId,
    action,
  });
}
