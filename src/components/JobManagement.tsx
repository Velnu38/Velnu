import { useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import type { CurrentBusiness } from "../lib/business";
import { canAccess } from "../lib/workspaceAccess";
import { confirmNavigation } from "../lib/unsavedChanges";
import { formatServiceAddress, type ServiceAddress } from "../lib/googleMaps";
import {
  hasActiveJobAppointment,
  jobNeedsStatusUpdate,
  jobStatusLabels,
  type JobStatus,
} from "../lib/jobActions";
import type { JobWorkflow } from "../services/jobs";
import type { Worker } from "../services/schedulingWorkflow";
import {
  getApprovedWork,
  getJobManagementSignals,
  prepareApprovedWork,
  type ApprovedWork,
  type JobSignals,
} from "../services/jobManagement";
import JobManagementWorkspace from "./JobManagementWorkspace";
import "./job-management.css";
export type ManagementJob = JobWorkflow & {
  id: string;
  title: string;
  status: string;
  customer_id: string | null;
  source_estimate_id?: string | null;
  scheduled_start: string | null;
  scheduled_end?: string | null;
  assigned_user_ids?: string[];
  customers:
    | {
        first_name: string | null;
        last_name: string | null;
        company: string | null;
      }[]
    | {
        first_name: string | null;
        last_name: string | null;
        company: string | null;
      }
    | null;
  properties?: ServiceAddress[] | null;
};
type Filter =
  | "active"
  | "approved"
  | "unscheduled"
  | "in_progress"
  | "attention"
  | "billing"
  | "history"
  | "all";
const customer = (job: ManagementJob) => {
  const c = Array.isArray(job.customers) ? job.customers[0] : job.customers;
  return c
    ? [c.first_name, c.last_name].filter(Boolean).join(" ") ||
        c.company ||
        "Customer"
    : "Customer";
};
const closed = (job: ManagementJob) =>
  ["completed", "canceled"].includes(job.status);
export default function JobManagement({
  business,
  jobs,
  team,
  revision,
  selectedJobId,
  onSelect,
  onUpdated,
  customerScope = "",
  initialComplete = false,
}: {
  business: CurrentBusiness;
  jobs: ManagementJob[];
  team: Worker[];
  revision: number;
  selectedJobId: string | null;
  onSelect: (id: string | null) => void;
  onUpdated: () => void;
  customerScope?: string;
  initialComplete?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("active"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [signals, setSignals] = useState<Record<string, JobSignals> | null>(null),
    [approved, setApproved] = useState<ApprovedWork[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0),
    [summaryOpen, setSummaryOpen] = useState(
      () => !selectedJobId || window.matchMedia("(min-width:821px)").matches,
    );
  const saving = useRef(false),
    scope = useRef(business.id);
  scope.current = business.id;
  const canBill =
    canAccess(business, "billing") &&
    ["owner", "admin", "office"].includes(business.role);
  const zone = business.timezone || "America/New_York",
    now = new Date();
  const jobKey = jobs
    .map((j) => j.id)
    .sort()
    .join(",");
  useEffect(() => {
    let active = true;
    setError("");
    setSignals(null);
    Promise.all([
      getJobManagementSignals(
        business.id,
        jobs.map((j) => j.id),
      ),
      canBill
        ? getApprovedWork(business.id, customerScope)
        : Promise.resolve([]),
    ])
      .then(([rows, work]) => {
        if (active) {
          setSignals(Object.fromEntries(rows.map((r) => [r.job_id, r])));
          setApproved(work);
        }
      })
      .catch((e) => {
        if (active)
          setError(
            (e as Error).message || "The management queue could not load.",
          );
      });
    return () => {
      active = false;
    };
  }, [business.id, jobKey, revision, retry, canBill, customerScope]);
  const active = jobs.filter((j) => !closed(j)),
    unscheduled = active.filter((j) => !hasActiveJobAppointment(j)),
    progress = active.filter((j) => j.status === "in_progress"),
    billing = canBill
      ? jobs.filter(
          (j) =>
            j.status === "completed" &&
            (!j.invoice || ["draft", "void"].includes(j.invoice.status)),
        )
      : [];
  const attention = (j: ManagementJob) =>
    !closed(j) &&
    (jobNeedsStatusUpdate(j, now, zone) ||
      !j.assigned_user_ids?.length ||
      (!!signals?.[j.id] &&
        (signals[j.id].due_tasks > 0 ||
          signals[j.id].materials_needed > 0 ||
          signals[j.id].pending_changes > 0)));
  const needsAttention = active.filter(attention);
  const filtered = jobs
    .filter(
      (j) =>
        filter === "all" ||
        (filter === "history" && closed(j)) ||
        (filter === "active" && !closed(j)) ||
        (filter === "approved" && !closed(j) && !!j.source_estimate_id) ||
        (filter === "unscheduled" &&
          !closed(j) &&
          !hasActiveJobAppointment(j)) ||
        (filter === "in_progress" && j.status === "in_progress") ||
        (filter === "billing" && billing.some((b) => b.id === j.id)) ||
        (filter === "attention" && attention(j)),
    )
    .filter((j) =>
      [
        j.title,
        customer(j),
        j.id,
        ...(j.properties || []).map((p) => formatServiceAddress(p)),
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const approvedFiltered = [
    "approved",
    "active",
    "all",
    "unscheduled",
  ].includes(filter)
    ? approved.filter((a) =>
        [a.title, a.customer, a.estimate_number]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
    : [];
  const entries = [
    ...approvedFiltered.map((a) => ({ kind: "approved" as const, data: a })),
    ...filtered.map((j) => ({ kind: "job" as const, data: j })),
  ];
  const maxPage = Math.max(0, Math.ceil(entries.length / 10) - 1),
    currentPage = Math.min(page, maxPage),
    visible = entries.slice(currentPage * 10, currentPage * 10 + 10);
  function choose(id: string) {
    if (!confirmNavigation()) return;
    onSelect(id);
    setSummaryOpen(window.matchMedia("(min-width:821px)").matches);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(".jm-workspace h2")
        ?.scrollIntoView?.({ block: "start", behavior: "smooth" }),
    );
  }
  async function prepare(item: ApprovedWork) {
    if (saving.current || !confirmNavigation()) return;
    saving.current = true;
    setBusy(true);
    setError("");
    const businessId = business.id;
    try {
      const id = await prepareApprovedWork(businessId, item.id);
      if (scope.current === businessId) {
        setApproved((rows) => rows.filter((a) => a.id !== item.id));
        choose(id);
        onUpdated();
      }
    } catch (e) {
      if (scope.current === businessId)
        setError(
          (e as Error).message ||
            "Approved work could not be prepared. Retry this estimate.",
        );
    } finally {
      saving.current = false;
      if (scope.current === businessId) setBusy(false);
    }
  }
  function selectFilter(value: Filter) {
    if (!confirmNavigation()) return;
    setFilter(value);
    setPage(0);
    setSummaryOpen(true);
    if (selectedJobId) onSelect(null);
  }
  const query = new URLSearchParams(location.search),
    requested = query.get("section"),
    initialSection =
      requested === "photos-expenses"
        ? "photos"
        : (([
            "tasks",
            "schedule",
            "materials",
            "photos",
            "changes",
            "billing",
            "activity",
          ].includes(requested || "")
            ? requested
            : "overview") as
            | "overview"
            | "tasks"
            | "schedule"
            | "materials"
            | "photos"
            | "changes"
            | "billing"
            | "activity");
  return (
    <div
      className={"job-management" + (selectedJobId ? " has-selected-job" : "")}
    >
      <details
        className="jm-summary"
        open={summaryOpen}
        onToggle={(e) => setSummaryOpen(e.currentTarget.open)}
      >
        <summary>
          Job overview <span>{active.length} active jobs</span>
        </summary>
        <div className="jm-metrics" aria-label="Job management filters">
          {[
            {
              id: "unscheduled" as const,
              label: "Ready to schedule",
              count: unscheduled.length + approved.length,
            },
            {
              id: "in_progress" as const,
              label: "In progress",
              count: progress.length,
            },
            {
              id: "attention" as const,
              label: "Needs attention",
              count: signals ? needsAttention.length : null,
            },
            ...(canBill
              ? [
                  {
                    id: "billing" as const,
                    label: "Ready to invoice",
                    count: billing.length,
                  },
                ]
              : []),
          ].map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={filter === item.id}
              onClick={() => selectFilter(item.id)}
            >
              <span>{item.label}</span>
              <strong>{item.count === null ? "—" : item.count}</strong>
              <small>View jobs →</small>
            </button>
          ))}
        </div>
      </details>
      {error && (
        <p role="alert" className="jm-error">
          {error}{" "}
          <button
            className="text-button"
            type="button"
            onClick={() => setRetry((v) => v + 1)}
          >
            Retry queue
          </button>
        </p>
      )}
      <div className="jm-layout">
        <aside className="jm-queue" aria-label="Approved and active job queue">
          <header>
            <h2>Choose a job</h2>
            <p>Approved work and existing jobs, ready to manage.</p>
          </header>
          <label>
            Find a job
            <input
              type="search"
              value={search}
              placeholder="Job, customer or address"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            Show
            <select
              value={filter}
              onChange={(e) => selectFilter(e.target.value as Filter)}
            >
              {Object.entries({
                active: "Active jobs",
                approved: "Approved work",
                unscheduled: "Ready to schedule",
                in_progress: "In progress",
                attention: "Needs attention",
                ...(canBill ? { billing: "Ready to invoice" } : {}),
                history: "History",
                all: "All jobs",
              }).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="quiet jm-queue-count">
            {entries.length} {entries.length === 1 ? "job" : "jobs"}
            {filter === "attention" && !signals
              ? " · attention counts unavailable"
              : ""}
          </p>
          <div className="jm-job-options">
            {visible.map((entry) =>
              entry.kind === "approved" ? (
                <article
                  className="jm-approved-work"
                  key={"approved:" + entry.data.id}
                >
                  <strong>{entry.data.title}</strong>
                  <span>{entry.data.customer}</span>
                  <small>{entry.data.estimate_number} · Approved</small>
                  <button
                    type="button"
                    className="secondary-button compact"
                    disabled={busy}
                    onClick={() => void prepare(entry.data)}
                  >
                    Manage approved work
                  </button>
                </article>
              ) : (
                <button
                  type="button"
                  className="jm-job-option"
                  key={entry.data.id}
                  aria-pressed={selectedJobId === entry.data.id}
                  disabled={busy}
                  onClick={() => choose(entry.data.id)}
                >
                  <strong>{entry.data.title}</strong>
                  <span>{customer(entry.data)}</span>
                  <small>
                    {hasActiveJobAppointment(entry.data)
                      ? DateTime.fromISO(
                          entry.data.active_appointment!.starts_at,
                        )
                          .setZone(zone)
                          .toFormat("MMM d · h:mm a")
                      : closed(entry.data)
                        ? "History"
                        : "No active visit"}
                  </small>
                  <span className="jm-status">
                    {jobStatusLabels[entry.data.status as JobStatus] ||
                      entry.data.status}
                  </span>
                  {signals?.[entry.data.id] &&
                    signals[entry.data.id].tasks_total > 0 && (
                      <small>
                        {signals[entry.data.id].tasks_completed}/
                        {signals[entry.data.id].tasks_total} tasks complete
                      </small>
                    )}
                </button>
              ),
            )}
          </div>
          {!entries.length && (
            <div className="jm-queue-empty">
              <strong>
                {jobs.length || approved.length
                  ? "No matching jobs"
                  : "Your work starts here"}
              </strong>
              <p>
                {jobs.length || approved.length
                  ? "Choose another filter or search."
                  : "Approved estimates appear here automatically. You can also create a job from the Jobs page."}
              </p>
            </div>
          )}
          {maxPage > 0 && (
            <nav className="jm-pagination" aria-label="Management queue pages">
              <button
                type="button"
                className="secondary-button compact"
                disabled={currentPage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <span>
                {currentPage + 1} / {maxPage + 1}
              </span>
              <button
                type="button"
                className="secondary-button compact"
                disabled={currentPage === maxPage}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </aside>
        <div className="jm-selected">
          {selectedJobId ? (
            <>
              <div className="jm-mobile-picker">
                <label>
                  Selected job
                  <select
                    value={selectedJobId}
                    onChange={(e) => choose(e.target.value)}
                  >
                    {!jobs.some((j) => j.id === selectedJobId) && (
                      <option value={selectedJobId}>Selected job</option>
                    )}
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.title} · {customer(j)}
                        {closed(j) ? " · History" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    if (confirmNavigation()) onSelect(null);
                  }}
                >
                  Choose another job
                </button>
              </div>
              <JobManagementWorkspace
                key={[
                  business.id,
                  selectedJobId,
                  business.role,
                  business.access_modules?.join(","),
                ].join(":")}
                business={business}
                jobId={selectedJobId}
                team={team}
                revision={revision}
                onUpdated={onUpdated}
                initialSection={initialSection}
                initialComplete={initialComplete}
              />
            </>
          ) : (
            <section className="jm-welcome">
              <span className="jm-welcome-mark" aria-hidden="true">
                ✓
              </span>
              <p className="eyebrow">Job Management</p>
              <h2>Turn approved work into finished jobs.</h2>
              <p>
                Choose a job to organize its tasks, crew, materials, costs and
                billing in one workspace.
              </p>
              <div className="jm-welcome-features">
                <span>Plan the work</span>
                <span>Track execution</span>
                <span>Review billing</span>
              </div>
              {canBill && <a href="/?view=estimates">Review estimates →</a>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
