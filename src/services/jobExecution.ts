import { supabase } from "../lib/supabase";
import { announceCalendarChange } from "../lib/workEvents";
import { prepareRecordImage } from "../lib/businessStorage";
export type JobVisit = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  worker_ids: string[];
  version: number;
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
  // The PDF library accepts JPEG/PNG. Legacy WebP job photos are converted
  // only for this download; the retained source object is never changed.
  const image = data.type === 'image/webp' || /\.webp$/i.test(path)
    ? await prepareRecordImage(new File([data], 'report-photo.webp', {type:'image/webp'}))
    : data;
  return new Uint8Array(await image.arrayBuffer());
}
