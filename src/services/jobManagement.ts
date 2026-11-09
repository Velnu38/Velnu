import { supabase } from "../lib/supabase";
import { announceCalendarChange } from "../lib/workEvents";
import type { JobWorkspace } from "./operations";
export type JobMaterial = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  supplier: string;
  status: "needed" | "ordered" | "received" | "used";
  estimated_cost?: number | null;
  version: number;
};
export type JobManagementData = Omit<JobWorkspace, "activity"> & {
  billing_access: boolean;
  calendar_access: boolean;
  materials: JobMaterial[];
  templates: { id: string; name: string; count: number }[];
  activity: { id: number; event: string; created_at: string; actor?: string }[];
  visits: import('./jobExecution').JobVisit[];
  source_estimate?: { id: string; number: string | null; total: number } | null;
  documents?: {
    id: string;
    number: string | null;
    status: string;
    total: number;
    balance_due: number;
    amount_paid: number;
    deposit: boolean;
  }[];
  changes?: {
    id: string;
    number: string | null;
    title: string;
    status: string;
    total: number;
    estimate_id?: string | null;
    source_invoice_id?: string | null;
    billing_action?: string | null;
  }[];
};
export type JobSignals = {
  job_id: string;
  tasks_total: number;
  tasks_completed: number;
  due_tasks: number;
  materials_needed: number;
  pending_changes: number;
};
export type ApprovedWork = {
  id: string;
  estimate_number: string | null;
  title: string;
  customer: string;
  customer_id: string;
  total: number;
};
function verified(data: unknown): JobManagementData {
  const d = data as JobManagementData;
  if (
    !d ||
    !Array.isArray(d.tasks) ||
    !Array.isArray(d.activity) ||
    !Array.isArray(d.materials) ||
    !Array.isArray(d.templates) ||
    !Array.isArray(d.visits) ||
    typeof d.financial_access !== "boolean" ||
    typeof d.billing_access !== "boolean" ||
    typeof d.calendar_access !== "boolean" ||
    (d.billing_access &&
      (!Array.isArray(d.documents) || !Array.isArray(d.changes)))
  )
    throw Error("Job management could not be verified. Please retry.");
  return d;
}
export async function getJobManagement(business: string, job: string) {
  const { data, error } = await supabase.rpc("get_job_management", {
    p_business: business,
    p_job: job,
  });
  if (error) throw error;
  return verified(data);
}
export async function manageJobManagement(
  business: string,
  job: string,
  action: string,
  payload: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc("manage_job_management", {
    p_business: business,
    p_job: job,
    p_action: action,
    p_payload: payload,
  });
  if (error) throw error;
  const result = verified(data);
  announceCalendarChange();
  return result;
}
export async function getJobManagementSignals(
  business: string,
  jobs: string[],
) {
  const result: JobSignals[] = [];
  for (let offset = 0; offset < jobs.length; offset += 200) {
    const ids = jobs.slice(offset, offset + 200);
    const { data, error } = await supabase.rpc("get_job_management_signals", {
      p_business: business,
      p_jobs: ids,
    });
    if (error) throw error;
    if (
      !Array.isArray(data) ||
      data.length !== ids.length ||
      ids.some((id) => !data.some((d) => d.job_id === id)) ||
      data.some((d) =>
        [
          "tasks_total",
          "tasks_completed",
          "due_tasks",
          "materials_needed",
          "pending_changes",
        ].some((key) => !Number.isInteger(d[key]) || d[key] < 0),
      )
    )
      throw Error("Job attention counts could not be verified.");
    result.push(...data);
  }
  return result;
}
export async function getApprovedWork(business: string, customer?: string) {
  const rows: ApprovedWork[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.rpc(
      "get_approved_management_queue",
      { p_business: business, p_customer: customer || null, p_offset: offset },
    );
    if (error) throw error;
    if (!Array.isArray(data)) throw Error("Approved work could not load.");
    rows.push(...data);
    if (data.length < 200) return rows;
  }
}
export async function prepareApprovedWork(business: string, estimate: string) {
  const { data, error } = await supabase.rpc(
    "prepare_approved_management_job",
    { p_business: business, p_estimate: estimate },
  );
  if (error) throw error;
  if (typeof data !== "string" || !data)
    throw Error(
      "The linked job could not be verified. Retry this same approved estimate.",
    );
  announceCalendarChange();
  return data;
}
export async function finishJobVisit(
  business: string,
  job: string,
  appointment: string,
) {
  const { error } = await supabase.rpc("finish_job_visit", {
    p_business: business,
    p_job: job,
    p_appointment: appointment,
  });
  if (error) throw error;
  announceCalendarChange();
}
