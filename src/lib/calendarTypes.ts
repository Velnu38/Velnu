export type AgendaWork = {
  source_key: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  document_kind: string;
  document_id: string;
  job_id?: string | null;
  assigned_user_ids?: string[];
};
export type AgendaReminder = {
  id: string;
  note: string | null;
  due_at: string;
  job_id: string | null;
};
