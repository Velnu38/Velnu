import { JOB_PHONE_QUERY } from './JobMobileMenu'
import { useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import type { CurrentBusiness } from "../lib/business";
import { canAccess } from "../lib/workspaceAccess";
import { confirmNavigation } from "../lib/unsavedChanges";
import {
  hasActiveJobAppointment,
  jobStatusLabels,
  type JobStatus,
} from "../lib/jobActions";
import type { Worker } from "../services/schedulingWorkflow";
import {
  getJobManagementPage,
  prepareApprovedWork,
  type ApprovedWork,
  type ManagementJob,
  type ManagementFilter as Filter,
  type ManagementPage,
} from "../services/jobManagement";
import JobManagementWorkspace from "./JobManagementWorkspace";
import "./job-management.css";
import "./job-phone.css";
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
  team,
  revision,
  selectedJobId,
  onSelect,
  onUpdated,
  customerScope = "",
  initialComplete = false,
}: {
  business: CurrentBusiness;
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
    [queryText, setQueryText] = useState(""),
    [result, setResult] = useState<{key:string;page:ManagementPage}|null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0),
    [summaryOpen, setSummaryOpen] = useState(
      () => !window.matchMedia(JOB_PHONE_QUERY).matches,
    );
  const [browseOpen,setBrowseOpen]=useState(false);
  const initialChoice=useRef(false);
  const saving = useRef(false),
    scope = useRef(business.id);
  scope.current = business.id;
  const canBill =
    canAccess(business, "billing") &&
    ["owner", "admin", "office"].includes(business.role);
  const zone = business.timezone || "America/New_York";
  const effectiveFilter = filter === "billing" && !canBill ? "active" : filter;
  const requestKey = JSON.stringify([business.id,business.role,business.access_modules,customerScope,effectiveFilter,queryText,page,revision,retry]);
  useEffect(()=>{const timer=setTimeout(()=>{setQueryText(search.trim());setPage(0)},200);return()=>clearTimeout(timer)},[search]);
  useEffect(() => {
    let active = true;
    setError("");
    getJobManagementPage(business.id,{customer:customerScope,filter:effectiveFilter,search:queryText,page})
      .then(data=>{if(active)setResult({key:requestKey,page:data})})
      .catch(e=>{if(active)setError((e as Error).message||"The management queue could not load.")});
    return()=>{active=false};
  }, [requestKey]);
  const data=result?.key===requestKey?result.page:null;
  const loading=!data&&!error;
  const signals=data?Object.fromEntries(data.signals.map(s=>[s.job_id,s])):null;
  const visible=data?.entries||[];
  const jobs=visible.filter(e=>e.kind==="job").map(e=>e.data);
  const total=data?.total??0;
  const maxPage=Math.max(0,Math.ceil(total/10)-1), currentPage=data?.page??0;
  useEffect(()=>{if(!data||initialChoice.current)return;initialChoice.current=true;if(!selectedJobId&&window.matchMedia(JOB_PHONE_QUERY).matches&&jobs.length)onSelect(jobs[0].id)},[data,selectedJobId]);
  function choose(id: string) {
    if (!confirmNavigation()) return;
    setBrowseOpen(false);
    onSelect(id);
    setSummaryOpen(!window.matchMedia(JOB_PHONE_QUERY).matches);
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
        setRetry(v=>v+1);
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
    setBrowseOpen(true);
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
            "reports",
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
            | "activity"
            | "reports");
  return (
    <div
      className={"job-management" + (selectedJobId ? " has-selected-job" : "") + (browseOpen ? " jm-browsing" : "")}
    >
      <details
        className="jm-summary"
        open={summaryOpen}
        onToggle={(e) => setSummaryOpen(e.currentTarget.open)}
      >
        <summary>
          Job overview <span>{data?.counts.active ?? "—"} active jobs</span>
        </summary>
        <div className="jm-metrics" aria-label="Job management filters">
          {[
            {
              id: "unscheduled" as const,
              label: "Ready to schedule",
              count: data?.counts.unscheduled ?? null,
            },
            {
              id: "in_progress" as const,
              label: "In progress",
              count: data?.counts.in_progress ?? null,
            },
            {
              id: "attention" as const,
              label: "Needs attention",
              count: data?.counts.attention ?? null,
            },
            ...(canBill
              ? [
                  {
                    id: "billing" as const,
                    label: "Ready to invoice",
                    count: data?.counts.billing ?? null,
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
              <div className="jm-context-heading"><button type="button" onClick={()=>{if(confirmNavigation()){initialChoice.current=true;setBrowseOpen(true);onSelect(null)}}}>‹ All jobs</button><strong>Job Management</strong></div>
              <div className="jm-mobile-picker">
                <label>
                  <span className="jm-picker-label">Job overview</span>
                  <span className="jm-picker-identity" aria-hidden="true"><strong>{jobs.find(j=>j.id===selectedJobId)?.title || "Selected job"}</strong><span>{jobs.find(j=>j.id===selectedJobId) ? customer(jobs.find(j=>j.id===selectedJobId)!) : "Choose another job"}{jobs.find(j=>j.id===selectedJobId)?.status && <span className="jm-picker-status">{jobs.find(j=>j.id===selectedJobId)!.status.replaceAll("_"," ")}</span>}</span></span>
                  <select
                    value={selectedJobId || ""}
                    aria-label="Selected job"
                    onChange={(e) => { if(e.target.value === "browse") { if(confirmNavigation()) { initialChoice.current=true; setBrowseOpen(true); onSelect(null); } } else choose(e.target.value); }}
                  >
                    {!selectedJobId && <option value="">Select a job</option>}
                    {selectedJobId && !jobs.some((j) => j.id === selectedJobId) && (
                      <option value={selectedJobId || ""}>Selected job</option>
                    )}
                    <option value="browse">Browse all jobs…</option>
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.title} · {customer(j)}
                        {closed(j) ? " · History" : ""}
                      </option>
                    ))}
                  </select>
                </label>

              </div>

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
              maxLength={200}
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
              value={effectiveFilter}
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
            {data ? `${total} ${total===1?"job":"jobs"}` : "Job counts unavailable"}
          </p>
          {loading && <p role="status">Loading management queue…</p>}
          <div className="jm-job-options" aria-busy={loading}>
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
          {data && !total && (
            <div className="jm-queue-empty">
              <strong>
                {data.counts.all || data.counts.approved
                  ? "No matching jobs"
                  : "Your work starts here"}
              </strong>
              <p>
                {data.counts.all || data.counts.approved
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
                onClick={() => setPage(Math.max(0, currentPage - 1))}
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
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </aside>
        <div className="jm-selected">
          {selectedJobId ? (
            <>
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
