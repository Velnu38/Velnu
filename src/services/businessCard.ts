import { supabase } from "../lib/supabase";
import type { VelnuTier } from "../lib/pricing";
export type BusinessCard = {
  name: string;
  phone: string;
  email: string;
  website: string;
  tagline: string;
  include_address: boolean;
  street: string;
  city: string;
  region: string;
  postal_code: string;
};
export type CardState = {
  plan: VelnuTier;
  can_edit: boolean;
  revision: string | null;
  card: BusinessCard | null;
  pending_send?: {
    id: string;
    revision: string;
    recipient: string;
    status: string;
  } | null;
};
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export const getBusinessCard = (business: string) =>
  rpc<CardState>("get_business_card", { p_business: business });
export const saveBusinessCard = (
  business: string,
  card: BusinessCard,
  revision: string | null,
) =>
  rpc<CardState>("save_business_card", {
    p_business: business,
    p_details: card,
    p_expected_revision: revision,
  });
export const exportBusinessCard = (business: string, revision: string) =>
  rpc<{ filename: string; vcard: string; revision: string }>(
    "export_business_card",
    { p_business: business, p_expected_revision: revision },
  );
export function downloadCard(file: File) {
  const url = URL.createObjectURL(file),
    a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function sendBusinessCard(
  business: string,
  recipient: string,
  revision: string,
  request: string,
) {
  const { data, error } = await supabase.functions.invoke(
    "send-business-card",
    {
      body: {
        business_id: business,
        document_id: business,
        document_type: "business_card",
        expected_recipient: recipient,
        expected_revision_id: revision,
        request_id: request,
      },
    },
  );
  window.dispatchEvent(new Event("finviant-delivery-changed"));
  if (error) {
    const response = (error as { context?: unknown }).context;
    const detail =
      response instanceof Response
        ? await response
            .clone()
            .json()
            .catch(() => null)
        : null;
    const failure = new Error(
      detail?.error ||
        "Email outcome is unconfirmed. Keep this send and retry; do not start another.",
    );
    Object.assign(failure, {
      notStarted: detail?.beta_send_not_started === true,
    });
    throw failure;
  }
  if (!data?.email_id || !["accepted", "delivered"].includes(data.status))
    throw new Error(
      "Email outcome is unconfirmed. Retry this same saved send.",
    );
  return data as { status: string; warning?: string };
}
