import type { CurrentBusiness } from "./business";
export const workspaceModules = [
  { id: "calendar", label: "Calendar & reminders" },
  { id: "jobs", label: "Jobs" },
  { id: "billing", label: "Estimates & invoices" },
  { id: "finances", label: "Financial Performance & expenses" },
] as const;
export type WorkspaceModule = (typeof workspaceModules)[number]["id"];
export function isPrimaryOwner(business: CurrentBusiness) {
  return business.role === "owner" && business.primary_owner === true;
}
export function canAccess(business: CurrentBusiness, module: WorkspaceModule) {
  if (business.field_restricted) return false;
  if (isPrimaryOwner(business)) return true;
  if (
    ["billing", "finances"].includes(module) &&
    !["owner", "admin", "office"].includes(business.role)
  )
    return false;
  return (business.access_modules ?? []).includes(module);
}
export function canUseAssistant(business: CurrentBusiness) {
  return (
    !business.field_restricted &&
    ["owner", "admin", "office", "technician", "viewer"].includes(business.role)
  );
}
export function canOpenView(business: CurrentBusiness, view: string) {
  const module = (
    {
      schedule: "calendar",
      reminders: "calendar",
      work: "jobs",
      estimates: "billing",
      invoices: "billing",
      change_orders: "billing",
      payments: "billing",
      bookkeeping: "finances",
    } as Record<string, WorkspaceModule>
  )[view];
  return !module || canAccess(business, module);
}
