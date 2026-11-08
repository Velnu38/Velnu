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
  job_status?: string;
  assigned_user_ids?: string[];
  address?: string;
  customer_name?: string;
};
export type AgendaReminder = {
  id: string;
  note: string | null;
  status?: string;
  due_at: string;
  job_id: string | null;
};

export type ProviderEvent = {
  id: string; title: string; description: string; location: string;
  starts_at: string; ends_at: string; all_day: boolean;
  start_date?: string; end_date?: string; url: string | null;
}
export type ConnectedEvent = ProviderEvent & {
  provider: 'google' | 'outlook'; email: string; calendar_name: string;
}
export type ConnectedAgenda = {
  events: ConnectedEvent[];
  issues: { provider: 'google' | 'outlook'; email: string; reconnect: boolean }[];
  connections: number;
}
