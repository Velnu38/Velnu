import { supabase } from "../lib/supabase";
import { announceCalendarChange } from "../lib/workEvents";
import { prepareRecordImage, uploadAttachment } from "../lib/businessStorage";
export type JobVisit = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  worker_ids: string[];
  version: number;
};
export type FieldAccount = {
  user_id: string;
  worker_id: string;
  enabled?: boolean;
  version: number;
};
export type FieldJob = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  customer: string;
  phone: string | null;
  address: string;
  visits: JobVisit[];
  tasks: {
    id: string;
    title: string;
    completed: boolean;
    version: number;
    visit_id: string | null;
    can_update: boolean;
  }[];
  time: {
    id: string;
    worked_on: string;
    minutes: number;
    note: string;
    status: string;
    review_note: string;
  }[];
};
export type CostReview = {
  pending_time: {
    id: string;
    worker_id: string;
    worked_on: string;
    minutes: number;
    note: string;
    version: number;
  }[];
  expenses: {
    id: string;
    date: string;
    amount: number;
    description: string;
    category: string;
    currency: string;
    excluded: boolean;
    reason: string | null;
  }[];
  possible_duplicate_time: {
    worked_on: string;
    worker_id: string | null;
    minutes: number;
    entries: number;
  }[];
};
export type CompletionSnapshot = {
  business: { name: string; phone: string | null; email: string | null };
  job: {
    id: string;
    title: string;
    customer: string;
    address: string | null;
    completed_at: string | null;
  };
  summary: string;
  tasks: { title: string; completed: boolean }[];
  visits: Pick<JobVisit, "title" | "starts_at" | "ends_at" | "status">[];
  photos: { id: string; name: string; path: string; media_type: string }[];
  signoff: {
    name: string;
    statement: string;
    method: string;
    captured_at: string;
    captured_by: string;
  } | null;
  created_at: string;
  version: number;
};
export type JobReport = {
  id: string;
  version: number;
  snapshot: CompletionSnapshot;
  created_at: string;
};
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error)
    throw Error(
      error.message ||
        "The result could not be confirmed. Refresh before retrying.",
    );
  return data as T;
}
export async function manageJobVisit(
  b: string,
  j: string,
  action: string,
  input: Record<string, unknown>,
) {
  const value = await rpc<string>("manage_job_visit", {
    p_business: b,
    p_job: j,
    p_action: action,
    p_input: input,
  });
  if (!value)
    throw Error("The saved visit could not be verified. Retry this request.");
  announceCalendarChange();
  return value;
}
export const getFieldAccounts = (b: string) =>
  rpc<FieldAccount[]>("get_field_accounts", { p_business: b });
export const setFieldAccount = (
  b: string,
  user: string,
  worker: string | null,
  version: number,
) =>
  rpc<void>("set_field_account", {
    p_business: b,
    p_user: user,
    p_worker: worker,
    p_version: version,
  });
export async function getFieldJobs(b: string, j?: string, offset = 0) {
  const data = await rpc<FieldJob[]>("get_field_jobs", {
    p_business: b,
    p_job: j || null,
    p_offset: offset,
  });
  if (!Array.isArray(data)) throw Error("Assigned jobs could not load.");
  return data;
}
export async function manageFieldJob(
  b: string,
  j: string,
  action: string,
  input: Record<string, unknown>,
) {
  await rpc("manage_field_job", {
    p_business: b,
    p_job: j,
    p_action: action,
    p_input: input,
  });
  announceCalendarChange();
}
export async function uploadFieldPhoto(b: string, j: string, file: File) {
  const blob = await prepareRecordImage(file),
    id = crypto.randomUUID();
  const path = await rpc<string>("prepare_field_photo", {
    p_business: b,
    p_job: j,
    p_id: id,
    p_name: file.name,
    p_bytes: blob.size,
  });
  if (path !== `${b}/${id}.jpg`)
    throw Error("Photo destination could not be verified.");
  await uploadAttachment("finviant-record-photos", path, blob);
}
export const getCostReview = (b: string, j: string) =>
  rpc<CostReview>("get_job_cost_review", { p_business: b, p_job: j });
export async function manageCostReview(
  b: string,
  j: string,
  action: string,
  input: Record<string, unknown>,
) {
  await rpc("manage_job_cost_review", {
    p_business: b,
    p_job: j,
    p_action: action,
    p_input: input,
  });
  announceCalendarChange();
}
export const getJobReports = (b: string, j: string) =>
  rpc<JobReport[]>("get_job_reports", { p_business: b, p_job: j });
export const createJobReport = (
  b: string,
  j: string,
  request: string,
  input: Record<string, unknown>,
) =>
  rpc<JobReport>("create_job_report", {
    p_business: b,
    p_job: j,
    p_request: request,
    p_input: input,
  });
export async function completionPhoto(path: string) {
  const { data, error } = await supabase.storage
    .from("finviant-record-photos")
    .download(path);
  if (error || !data)
    throw Error(
      "A report photo could not be loaded. Reconnect and retry the PDF.",
    );
  if (data.size > 10_000_000)
    throw Error("A report photo exceeds the size limit.");
  return new Uint8Array(await data.arrayBuffer());
}

export const clearFieldAccount = (b: string, user: string, version: number) =>
  rpc<void>("clear_field_account", {
    p_business: b,
    p_user: user,
    p_version: version,
  });
