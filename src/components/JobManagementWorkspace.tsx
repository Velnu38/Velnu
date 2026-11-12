import JobMobileMenu, { JOB_PHONE_QUERY, type JobMenuItem } from './JobMobileMenu'
import {jobNextStep} from '../lib/jobNextStep'
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { DateTime } from "luxon";
import { canWrite, type CurrentBusiness } from "../lib/business";
import { canAccess } from "../lib/workspaceAccess";
import { confirmNavigation, useUnsavedChanges } from "../lib/unsavedChanges";
import { useBusinessRefresh } from "../lib/useBusinessRefresh";
import {
  getJob,
  reopenJob,
  saveJobNotes,
  updateJobStatus,
} from "../services/jobs";
import { completeJob, type Worker } from "../services/schedulingWorkflow";
import { manageJobWorkspace, type JobTask } from "../services/operations";
import {
  getJobManagement,
  manageJobManagement,
  type JobManagementData,
  type JobMaterial,
} from "../services/jobManagement";
import { changeOrderStatusLabel } from "../lib/documentChangeOrders";
import { getDocumentChangeContext } from "../services/changeOrders";
import {
  hasActiveJobAppointment,
  jobInvoiceAction,
  jobStatusLabels,
  jobStatusNotice,
  nextJobAction,
  type JobStatus,
} from "../lib/jobActions";
import { formatServiceAddress } from "../lib/googleMaps";
import {
  TaskEditor,
  MaterialEditor,
  ChecklistTemplates,
  JobTaskList,
  materialLabels,
} from "./JobManagementEditors";
import { RecordTabs, RecordMoreMenu } from "./RecordDetail";
import JobWorkPlan from "./JobWorkPlan";
import JobVisits from "./JobVisits";
import JobCostReview from "./JobCostReview";
import JobCompletionReports from "./JobCompletionReports";
import RecordResources from "./RecordResources";
import DocumentChangeOrders from "./DocumentChangeOrders";
import DispatchJobDialog, {
  type JobScheduleMode,
} from "./scheduling/DispatchJobDialog";
import GoogleMapTools from "./GoogleMapTools";
import FormDialog from "./FormDialog";
import JobDetailsDialog from "./JobDetailsDialog";
const ScheduleEstimateDialog = lazy(
  () => import("./scheduling/ScheduleEstimateDialog"),
);
const ChangeOrdersPage = lazy(() => import("../pages/ChangeOrdersPage"));
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n,
  );
type Section =
  | "overview"
  | "tasks"
  | "schedule"
  | "materials"
  | "photos"
  | "changes"
  | "billing"
  | "activity"
  | "reports";
const sectionLabels: Record<Section, string> = {
  overview: "Overview",
  tasks: "Tasks",
  schedule: "Schedule & Crew",
  materials: "Materials",
  photos: "Photos & Expenses",
  changes: "Changes",
  billing: "Billing",
  activity: "Activity",
  reports: "Completion Report",
};
const reviewSignature = (data: JobManagementData) =>
  JSON.stringify([
    data.tasks.map((t) => [t.id, t.version]),
    data.budget?.version,
    data.visits.map((v) => [v.id, v.version, v.status]),
    data.recorded_expenses,
    data.pending_time_minutes,
    data.uncalculated_expenses,
    data.time?.map((t) => [t.id, t.minutes, t.hourly_cost]),
    data.materials.map((m) => [m.id, m.version]),
    data.changes?.map((c) => [c.id, c.status, c.total]),
    data.documents?.map((i) => [i.id, i.status, i.balance_due]),
  ]);
export default function JobManagementWorkspace({
  business,
  jobId,
  team,
  revision,
  onUpdated,
  initialSection = "overview",
  initialComplete = false,
}: {
  business: CurrentBusiness;
  jobId: string;
  team: Worker[];
  revision: number;
  onUpdated: () => void;
  initialSection?: Section;
  initialComplete?: boolean;
}) {
  const [job, setJob] = useState<Awaited<ReturnType<typeof getJob>> | null>(
      null,
    ),
    [data, setData] = useState<JobManagementData | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [compactSections,setCompactSections]=useState(()=>window.matchMedia(JOB_PHONE_QUERY).matches);
  useEffect(()=>{const media=window.matchMedia(JOB_PHONE_QUERY);const update=()=>setCompactSections(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[]);
  const [mobileDetail, setMobileDetail] = useState(initialSection !== 'overview' && new URLSearchParams(location.search).get('panel') !== 'menu');
  const [mobileBilling, setMobileBilling] = useState<'invoices'|'costs'>(new URLSearchParams(location.search).get('billing') === 'costs' ? 'costs' : 'invoices');
  const [section, setSection] = useState<Section>(initialSection),
    [notes, setNotes] = useState(""),
    [details, setDetails] = useState(false),
    [bookingOptions, setBookingOptions] = useState(false),
    [dispatch, setDispatch] = useState<JobScheduleMode | null>(null);
  const [taskEditor, setTaskEditor] = useState<JobTask | "new" | null>(null),
    [materialEditor, setMaterialEditor] = useState<JobMaterial | "new" | null>(
      null,
    ),
    [templates, setTemplates] = useState(false),
    [changeOrder, setChangeOrder] = useState<string | null>(null),
    [changeDocument, setChangeDocument] = useState(""),
    [costsOpened, setCostsOpened] = useState(initialSection === "billing"),
    [photosOpened, setPhotosOpened] = useState(initialSection === "photos");
  const [completion, setCompletion] = useState(initialComplete),
    [reviewed, setReviewed] = useState(false),
    [invoiceAction, setInvoiceAction] =
      useState<ReturnType<typeof jobInvoiceAction>>(null),
    [approvedValue, setApprovedValue] = useState<number | null>(null);
  const mounted = useRef(true),
    request = useRef(0),
    saving = useRef(false),
    current = useRef({ job, notes }),
    reopenRequest = useRef(crypto.randomUUID()),
    id = useId();
  current.current = { job, notes };
  const guard = useUnsavedChanges(busy),
    dirty = !!job && notes !== (job.description || "");
  useEffect(() => {
    if (dirty) guard.markDirty();
    else guard.markClean();
  }, [dirty]);
  const zone = business.timezone || "America/New_York",
    canEdit = canWrite(business.role) && canAccess(business, "jobs"),
    canSchedule =
      canEdit &&
      canAccess(business, "calendar") &&
      ["owner", "admin", "office"].includes(business.role);
  const canBill =
    canAccess(business, "billing") &&
    ["owner", "admin", "office"].includes(business.role);
  async function refresh() {
    const n = ++request.current;
    try {
      const [fresh, work] = await Promise.all([
        getJob(business.id, jobId),
        getJobManagement(business.id, jobId),
      ]);
      if (!mounted.current || n !== request.current) return;
      const previous = current.current.job,
        unsaved =
          previous && current.current.notes !== (previous.description || "");
      setJob(unsaved ? { ...fresh, description: previous.description } : fresh);
      if (!unsaved) setNotes(fresh.description || "");
      setData(work);
      setError("");
      if (work.source_estimate && work.billing_access) {
        setApprovedValue(null);
        void getDocumentChangeContext("estimate", work.source_estimate.id)
          .then((source) => {
            if (mounted.current && n === request.current)
              setApprovedValue(Number(source.current_total ?? source.total));
          })
          .catch(() => {});
      }
    } catch (e) {
      if (mounted.current && n === request.current)
        setError(
          (e as Error).message || "Unable to load this job. Retry to continue.",
        );
    } finally {
      if (mounted.current && n === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [business.id, jobId, revision]);
  useBusinessRefresh(business.id, () => {
    if (!saving.current) return refresh();
  });
  function changed() {
    onUpdated();
    void refresh();
  }
  async function run(action: () => Promise<unknown>, success: string) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (mounted.current) {
        setNotice(success);
        changed();
      }
    } catch (e) {
      if (mounted.current)
        setError(
          (e as Error).message ||
            "Unable to save. Your job remains available; refresh before retrying.",
        );
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function selectSection(next: Section, detail = true, billingView: 'invoices'|'costs' = 'invoices') {
    if (next === section && (!compactSections || (detail === mobileDetail && billingView === mobileBilling))) return;
    if (!confirmNavigation()) return;
    if (dirty) {
      setNotes(job?.description || "");
      guard.markClean();
    }
    if (next !== "billing") setCostsOpened(false);
    if (next !== "photos") setPhotosOpened(false);
    setSection(next);
    setMobileDetail(detail && next !== "overview");
    setMobileBilling(billingView);
    const url=new URL(location.href);url.searchParams.set('section',next);if(detail)url.searchParams.delete('panel');else url.searchParams.set('panel','menu');if(next==='billing'&&billingView==='costs')url.searchParams.set('billing','costs');else url.searchParams.delete('billing');history.replaceState(history.state,'',url.pathname+url.search);
    if (next === "photos") setPhotosOpened(true);
    if (next === "billing") setCostsOpened(true);
    if (compactSections) requestAnimationFrame(() => { const heading=document.getElementById(id + "-mobile-heading"); heading?.focus({preventScroll:true}); heading?.scrollIntoView?.({block:"start"}); });
  }
  async function saveNotes(e: FormEvent) {
    e.preventDefault();
    if (!job) return;
    const text = notes;
    await run(async () => {
      await saveJobNotes(business.id, jobId, text, job.description ?? null);
      if (mounted.current) {
        const saved = text.trim();
        current.current = {
          job: { ...job, description: saved || null },
          notes: saved,
        };
        setJob(current.current.job);
        setNotes(saved);
        guard.markClean();
      }
    }, "Job notes saved.");
  }
  const closed = !!job && ["completed", "canceled"].includes(job.status),
    booked = !!job && hasActiveJobAppointment(job),
    action = job && nextJobAction(job, canEdit, canSchedule);
  const outstandingTasks = data?.tasks.filter((t) => !t.completed) || [],
    missingMaterials =
      data?.materials.filter((m) => ["needed", "ordered"].includes(m.status)) ||
      [],
    pendingChanges =
      data?.changes?.filter((c) => ["draft", "sent"].includes(c.status)) || [];
  const uncostedHours = (data?.time || [])
    .filter((t) => Number(t.hourly_cost) === 0)
    .reduce((n, t) => n + Number(t.minutes) / 60, 0);
  const labor = (data?.time || []).reduce(
      (n, t) =>
        n +
        Math.round((Number(t.minutes) * Number(t.hourly_cost) * 100) / 60) /
          100,
      0,
    ),
    costs = Number(data?.recorded_expenses || 0) + labor;
  const finalDocuments =
      data?.documents?.filter((i) => !i.deposit && i.status !== "void") || [],
    issued = finalDocuments.filter((i) => i.status !== "draft"),
    depositPaid = (data?.documents || [])
      .filter((i) => i.deposit && i.status !== "void")
      .reduce((n, i) => n + Number(i.amount_paid), 0),
    balance = issued.reduce((n, i) => n + Number(i.balance_due), 0);
  const billingInvoice =
    job?.invoice && job.invoice.status !== "void" ? job.invoice : null;
  const changeDocuments = [
    ...(data?.source_estimate
      ? [
          {
            kind: "estimate" as const,
            id: data.source_estimate.id,
            number: data.source_estimate.number || "Approved estimate",
          },
        ]
      : []),
    ...finalDocuments.map((i) => ({
      kind: "invoice" as const,
      id: i.id,
      number: i.number || "Draft invoice",
    })),
  ];
  const selectedChangeDocument =
    changeDocuments.find((d) => d.kind + ":" + d.id === changeDocument) ||
    changeDocuments[0];
  const changeSource = selectedChangeDocument
    ? {
        documentType: selectedChangeDocument.kind,
        documentId: selectedChangeDocument.id,
        documentNumber: selectedChangeDocument.number,
        customerId: job?.customer_id || "",
        jobId,
      }
    : null;
  const unbilledChanges =
    data?.changes?.filter(
      (c) =>
        c.status === "approved" &&
        [
          "add_to_draft",
          "create_invoice",
          "verify_existing",
          "manual_review",
        ].includes(c.billing_action || ""),
    ) || [];

  const openVisits =
    data?.visits.filter((v) =>
      ["scheduled", "confirmed", "in_progress"].includes(v.status),
    ) || [];
  const remainingVisits =
    openVisits.length > 1 ||
    openVisits.some((v) => Date.parse(v.starts_at) > Date.now());
  const completeWarnings =
    outstandingTasks.length +
    missingMaterials.length +
    pendingChanges.length +
    unbilledChanges.length +
    Number(Number(data?.pending_time_minutes) > 0);
  const currentReview = useRef("");
  function reviewCompletion() {
    if (!data || !job || !confirmNavigation()) return;
    currentReview.current = reviewSignature(data);
    setReviewed(false);
    setCompletion(true);
  }
  useEffect(() => {
    if (initialComplete && data && !currentReview.current)
      currentReview.current = reviewSignature(data);
  }, [data, initialComplete]);
  async function complete() {
    if (!job || !data) return;
    await run(async () => {
      const latest = await getJobManagement(business.id, jobId);
      if (reviewSignature(latest) !== currentReview.current) {
        setData(latest);
        currentReview.current = reviewSignature(latest);
        setReviewed(false);
        throw Error(
          "This job changed. Review the updated checklist, materials and billing before completing it.",
        );
      }
      const result = await completeJob(jobId);
      if (mounted.current) {
        setCompletion(false);
        setInvoiceAction(jobInvoiceAction(result));
        setNotice(jobStatusNotice("completed", result));
      }
    }, "Job completed. Review billing before sending an invoice.");
  }
  const date = (value: string) =>
    DateTime.fromISO(value).setZone(zone).toFormat("EEE, MMM d · h:mm a");
  const tabs = (Object.keys(sectionLabels) as Section[]).filter(
    (s) => !["billing", "changes"].includes(s) || canBill,
  );
  const groups = [
    {label:'Summary',sections:['overview']},
    {label:'Work',sections:['tasks','schedule','materials','photos']},
    {label:'Billing',sections:['billing','changes']},
    {label:'Records',sections:['activity','reports']},
  ].map(group=>({...group,sections:group.sections.filter(s=>tabs.includes(s as Section))})).filter(group=>group.sections.length);
  const activeGroup=groups.find(group=>group.sections.includes(section))||groups[0];
  const showPanel = (name:Section) => section === name && (!compactSections || mobileDetail);
  const mobileHome = compactSections && !mobileDetail;
  const alertCount = Number(missingMaterials.length > 0 && !closed) + Number(outstandingTasks.some(t=>t.due_on && t.due_on < DateTime.now().setZone(zone).toISODate()!) && !closed) + Number(unbilledChanges.length > 0) + Number(pendingChanges.length > 0) + Number(!closed && !job?.assigned_user_ids?.length && canSchedule);
  const menuItems:JobMenuItem[] = activeGroup.label === 'Work' ? [
    {key:'tasks',label:'Tasks & templates',description:data ? `${data.tasks.filter(t=>t.completed).length} of ${data.tasks.length} complete` : 'Work checklist',onClick:()=>selectSection('tasks')},
    {key:'schedule',label:'Visits & crew',description:booked ? date(job!.active_appointment!.starts_at) : 'Review visits and assignments',onClick:()=>selectSection('schedule')},
    {key:'materials',label:'Materials',description:missingMaterials.length ? `${missingMaterials.length} not received` : 'Review supplies and quantities',onClick:()=>selectSection('materials')},
    {key:'photos',label:'Photos & expenses',description:'View job records',onClick:()=>selectSection('photos')},
  ] : activeGroup.label === 'Billing' ? [
    {key:'billing',label:'Invoices',description:'Review linked documents',onClick:()=>selectSection('billing',true,'invoices')},
    ...(data?.financial_access ? [{key:'costs',label:'Costs & budget',description:'Budget, labor and expenses',onClick:()=>selectSection('billing',true,'costs')}] : []),
    {key:'changes',label:'Change orders',description:'Review approved and pending changes',onClick:()=>selectSection('changes')},
  ] : [
    {key:'activity',label:'Activity history',description:'Changes, updates and job events',onClick:()=>selectSection('activity')},
    {key:'reports',label:'Completion reports',description:'Review saved reports',onClick:()=>selectSection('reports')},
  ];
  const step=jobNextStep({status:job?.status||'',ready:!!data&&!loading&&!error,canEdit,canSchedule,canBill,booked,
    crew:!!job?.assigned_user_ids?.length,futureVisit:!!job?.scheduled_start&&Date.parse(job.scheduled_start)>Date.now(),
    remainingVisits,tasks:outstandingTasks.length,materials:missingMaterials.length,changes:pendingChanges.length+unbilledChanges.length,invoice:billingInvoice});
  function takeNextStep(){
    if(step.action==='schedule'||step.action==='crew')setDispatch(step.action==='crew'?'crew':'appointment');
    else if(step.action==='start')void run(()=>updateJobStatus(jobId,'in_progress'),'Job started.');
    else if(step.action==='complete')reviewCompletion();
    else selectSection(({visits:'schedule',history:'activity',invoice:'billing'} as Record<string,Section>)[step.action]||step.action as Section);
  }
  const notesEditor = (
                  <form onSubmit={saveNotes}>
                    <label className="sr-only" htmlFor={id + "-notes"}>
                      Job notes
                    </label>
                    <textarea
                      id={id + "-notes"}
                      maxLength={4000}
                      rows={3}
                      value={notes}
                      disabled={!canEdit || busy}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Work scope, site access, customer instructions…"
                    />
                    {canEdit && dirty && (
                      <button
                        className="secondary-button compact"
                        disabled={busy}
                      >
                        Save job notes
                      </button>
                    )}
                  </form>
  );
  const quickActions = job && (
            <div className="jm-job-actions">
              {job.customers[0]?.phone && (
                <a
                  className="secondary-button compact"
                  aria-label="Call customer"
                  href={"tel:" + job.customers[0].phone}
                >
                  Call customer
                </a>
              )}
              {job.properties[0] && (
                <GoogleMapTools
                  address={job.properties[0]}
                  compact
                  directionsOnly
                />
              )}
              <button
                type="button"
                className="secondary-button compact"
                aria-label="Job details"
                onClick={() => setDetails(true)}
              >
                Job details
              </button>
            </div>
  );
  const tab = (s: string) => id + "-" + s;
  if (changeOrder && changeSource)
    return (
      <Suspense fallback={<p role="status">Loading change orders…</p>}>
        <ChangeOrdersPage
          business={business}
          context={changeSource}
          initialOrder={changeOrder}
          onBack={() => {
            setChangeOrder(null);
            changed();
          }}
        />
      </Suspense>
    );
  return (
    <section
      className={"jm-workspace" + (compactSections ? " jm-phone-workspace" : "") + (compactSections && (mobileDetail || section !== "overview") ? " jm-compact-job" : "")}
      aria-label="Selected job workspace"
      aria-busy={loading || busy}
    >
      {error && (
        <p role="alert" className="jm-error">
          {error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => void refresh()}
          >
            Retry job
          </button>
        </p>
      )}
      {loading && !job && <p role="status">Loading selected job…</p>}
      {job && (
        <>
          <header className="jm-job-header">
            <div>
              <p className="eyebrow">
                Selected job · {job.id.slice(0, 8).toUpperCase()}
              </p>
              <span className="jm-phone-status jm-status">{jobStatusLabels[job.status as JobStatus] || job.status}</span>
              <h2>{job.title}</h2>
              <p>
                {job.customers
                  .map(
                    (c) =>
                      [c.first_name, c.last_name].filter(Boolean).join(" ") ||
                      c.company,
                  )
                  .join(", ") || "Customer"}{" "}
                <span className="jm-status">
                  {jobStatusLabels[job.status as JobStatus] || job.status}
                </span>
              </p>
              {job.properties[0] ? (
                <p className="jm-address">
                  {formatServiceAddress(job.properties[0])}
                </p>
              ) : (
                <p className="quiet">Service address to confirm</p>
              )}
            </div>
            {!compactSections && quickActions}
          </header>
          {notice && (
            <p role="status" className="guided-success">
              {notice}{" "}
              {invoiceAction && canBill && (
                <a href={invoiceAction.href}>{invoiceAction.label}</a>
              )}
            </p>
          )}
          {(!compactSections || (mobileHome && section === "overview")) && <>
          <div className="jm-next-action">
            <div><small>Next action</small><strong>{step.detail}</strong></div>
            <div className="jm-inline-actions">
              {step.action==='invoice'?<a className="primary-button" href={billingInvoice?'/?view=invoices&document='+billingInvoice.id:'/?view=invoices&job='+jobId}>{step.label}</a>:
                <button type="button" className="primary-button" disabled={busy||!data||loading||!!error} onClick={takeNextStep}>{step.label}</button>}
              {!compactSections&&action==='complete'&&step.action!=='complete'&&<button type="button" className="secondary-button" disabled={busy||!data||loading||!!error} onClick={reviewCompletion}>Review completion</button>}
            </div>
          </div>
          {data && alertCount > 0 && (
            <details className="jm-alert-disclosure" open={!compactSections}><summary>Needs attention ({alertCount})</summary><div className="jm-alerts">
              {missingMaterials.length > 0 && !closed && (
                <button
                  type="button"
                  onClick={() => selectSection("materials")}
                >
                  {missingMaterials.length}{" "}
                  {missingMaterials.length === 1 ? "material" : "materials"} not
                  received <span>Review materials →</span>
                </button>
              )}
              {outstandingTasks.some(
                (t) =>
                  t.due_on &&
                  t.due_on < DateTime.now().setZone(zone).toISODate()!,
              ) &&
                !closed && (
                  <button type="button" onClick={() => selectSection("tasks")}>
                    Overdue tasks <span>Review tasks →</span>
                  </button>
                )}
              {unbilledChanges.length > 0 && (
                <button type="button" onClick={() => selectSection("changes")}>
                  {unbilledChanges.length} approved changes need billing review{" "}
                  <span>Review billing →</span>
                </button>
              )}
              {pendingChanges.length > 0 && (
                <button type="button" onClick={() => selectSection("changes")}>
                  {pendingChanges.length} changes awaiting action{" "}
                  <span>Review changes →</span>
                </button>
              )}
              {!closed && !job.assigned_user_ids?.length && canSchedule && (
                <button type="button" onClick={() => setDispatch("crew")}>
                  No crew assigned <span>Assign crew →</span>
                </button>
              )}
            </div></details>
          )}
          </>}
          {compactSections&&!mobileDetail&&<div className="jm-section-groups" role="group" aria-label="Job workspace areas">{groups.map(group=><button type="button" key={group.label} aria-pressed={group===activeGroup} onClick={()=>selectSection(group.sections[0] as Section,false)}>{group.label}</button>)}</div>}
          {!compactSections && <RecordTabs
            label="Job management sections"
            active={tab(section)}
            tabs={tabs.map((s) => ({ id: tab(s), label: sectionLabels[s] }))}
            onChange={(value) =>
              selectSection(tabs.find((s) => tab(s) === value) || "overview")
            }
          />}
          {!data && !loading && !error && (
            <p role="alert">
              The work plan is unavailable.{" "}
              <button type="button" onClick={() => void refresh()}>
                Retry job
              </button>
            </p>
          )}
          {compactSections && <div className="jm-mobile-heading" id={id + '-mobile-heading'} tabIndex={-1}>
            {mobileDetail && <button type="button" className="jm-back-button" onClick={()=>selectSection(activeGroup.sections[0] as Section,false)}>‹ Back to {activeGroup.label}</button>}
            {mobileDetail && <h3>{section === 'billing' ? (mobileBilling === 'costs' ? 'Costs & budget' : 'Invoices') : sectionLabels[section]}</h3>}
          </div>}
          {data && mobileHome && section === 'overview' && <section className="jm-phone-summary" aria-label="Job summary">
            <dl className="jm-visit-facts"><div><dt>Next visit</dt><dd>{booked ? date(job.active_appointment!.starts_at) : 'Not scheduled'}</dd></div><div><dt>Assigned crew</dt><dd>{job.assigned_user_ids?.map((worker:string)=>team.find(w=>w.id===worker)?.label||'Worker unavailable').join(', ') || 'Not assigned'}</dd></div></dl>
            {quickActions}
            <p className="jm-progress-line">Tasks {data.tasks.filter(t=>t.completed).length}/{data.tasks.length} complete · {missingMaterials.length ? `${missingMaterials.length} materials not received` : 'No outstanding materials'}</p>
            <details className="jm-notes-disclosure"><summary>Job notes &amp; access instructions</summary>{notesEditor}</details>
          </section>}
          {data && mobileHome && section !== 'overview' && <JobMobileMenu title={activeGroup.label === 'Work' ? 'Manage the work' : activeGroup.label === 'Billing' ? 'Job billing' : 'Job records'} items={menuItems}>
            {activeGroup.label === 'Billing' && <div className="jm-menu-finances"><dl className="jm-financial-lines">
              {data.source_estimate && <div><dt>{approvedValue === null ? 'Original estimate' : 'Approved scope'}</dt><dd>{money(approvedValue ?? Number(data.source_estimate.total))}</dd></div>}
              {data.financial_access && <div><dt>Recorded costs</dt><dd>{money(costs)}</dd></div>}
              {data.billing_access && <><div><dt>Deposit received</dt><dd>{money(depositPaid)}</dd></div><div><dt>Issued invoice balance</dt><dd>{money(balance)}</dd></div></>}
            </dl><p className="quiet">Recorded costs may be incomplete. Drafts are excluded from the issued balance.</p></div>}
          </JobMobileMenu>}
          {data && mobileHome && activeGroup.label==='Work' && booked && <section className="jm-menu-context"><strong>Next visit</strong><span>{date(job.active_appointment!.starts_at)}</span><button type="button" className="secondary-button" onClick={()=>selectSection('schedule')}>Review visit</button></section>}
          {data && mobileHome && activeGroup.label==='Records' && data.activity.length>0 && <section className="jm-menu-context"><h4>Latest activity</h4><Activity entries={data.activity.slice(0,1)} zone={zone}/></section>}

          {data && (
            <>
              <div
                role="tabpanel"
                id={tab("overview") + "-panel"}
                aria-labelledby={compactSections ? undefined : tab("overview") + "-tab"}
                aria-label={compactSections ? sectionLabels["overview"] : undefined}
                hidden={compactSections || section !== "overview"}
                className="jm-overview-grid"
              >
                <section className="jm-card">
                  <header>
                    <h3>Work checklist</h3>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => selectSection("tasks")}
                    >
                      Manage tasks
                    </button>
                  </header>
                  <p>
                    {data.tasks.filter((t) => t.completed).length} of{" "}
                    {data.tasks.length} complete
                  </p>
                  {data.tasks.length > 0 && (
                    <progress
                      max={data.tasks.length}
                      value={data.tasks.filter((t) => t.completed).length}
                      aria-label="Job checklist progress"
                    />
                  )}
                  {outstandingTasks.length ? (
                    <ul className="jm-summary-list">
                      {outstandingTasks.slice(0, 3).map((t) => (
                        <li key={t.id}>{t.title}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="quiet">
                      {data.tasks.length
                        ? "All checklist items complete."
                        : "Add the steps needed to finish this job."}
                    </p>
                  )}
                  {canEdit && !closed && (
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() => setTaskEditor("new")}
                    >
                      + Add task
                    </button>
                  )}
                </section>
                <section className="jm-card">
                  <header>
                    <h3>Schedule &amp; Crew</h3>
                    {canSchedule && !closed && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setDispatch("appointment")}
                      >
                        {booked ? "Reschedule" : "Schedule"}
                      </button>
                    )}
                  </header>
                  <strong>
                    {booked
                      ? date(job.active_appointment!.starts_at)
                      : "No active appointment"}
                  </strong>
                  <p>
                    {job.assigned_user_ids
                      ?.map(
                        (worker: string) =>
                          team.find((w) => w.id === worker)?.label ||
                          "Worker unavailable",
                      )
                      .join(", ") || "Crew not assigned"}
                  </p>
                  <p className="quiet">
                    {booked
                      ? "Appointment saved. Confirm arrangements with your customer."
                      : "Book the next visit without creating another job."}
                  </p>
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => selectSection("schedule")}
                  >
                    View visits & crew
                  </button>
                </section>
                <section className="jm-card">
                  <header>
                    <h3>Materials</h3>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => selectSection("materials")}
                    >
                      Manage materials
                    </button>
                  </header>
                  {data.materials.length ? (
                    <ul className="jm-summary-list">
                      {data.materials.slice(0, 3).map((m) => (
                        <li key={m.id}>
                          {m.name}
                          <span
                            className={
                              "jm-status " +
                              (m.status === "needed" ? "is-warning" : "")
                            }
                          >
                            {materialLabels[m.status]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="quiet">
                      Track supplies, quantities and order status.
                    </p>
                  )}
                  {canEdit && !closed && (
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() => setMaterialEditor("new")}
                    >
                      + Add material
                    </button>
                  )}
                </section>
                {(data.financial_access || data.billing_access) && (
                  <section className="jm-card">
                    <header>
                      <h3>Job financials</h3>
                      {canBill && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => selectSection("billing")}
                        >
                          Review billing
                        </button>
                      )}
                    </header>
                    <dl className="jm-financial-lines">
                      {data.source_estimate && (
                        <div>
                          <dt>
                            {approvedValue === null
                              ? "Original estimate"
                              : "Approved scope"}
                          </dt>
                          <dd>
                            {money(
                              approvedValue ??
                                Number(data.source_estimate.total),
                            )}
                          </dd>
                        </div>
                      )}
                      {data.financial_access && (
                        <div>
                          <dt>Recorded costs</dt>
                          <dd>{money(costs)}</dd>
                        </div>
                      )}
                      {data.billing_access && (
                        <>
                          <div>
                            <dt>Deposit paid</dt>
                            <dd>{money(depositPaid)}</dd>
                          </div>
                          <div>
                            <dt>Issued invoice balance</dt>
                            <dd>{money(balance)}</dd>
                          </div>
                        </>
                      )}
                    </dl>
                    <p className="quiet">
                      Recorded costs may be incomplete. Drafts are excluded from
                      the issued balance.
                    </p>
                  </section>
                )}
                <section className="jm-card jm-card-wide">
                  <header>
                    <h3>Job notes &amp; access instructions</h3>
                  </header>
                  {!compactSections && notesEditor}
                </section>
                <section className="jm-card jm-card-wide">
                  <header>
                    <h3>Recent activity</h3>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => selectSection("activity")}
                    >
                      View history
                    </button>
                  </header>
                  <Activity entries={data.activity.slice(0, 3)} zone={zone} />
                </section>
              </div>
              <div
                role="tabpanel"
                id={tab("tasks") + "-panel"}
                aria-labelledby={compactSections ? undefined : tab("tasks") + "-tab"}
                aria-label={compactSections ? sectionLabels["tasks"] : undefined}
                hidden={!showPanel("tasks")}
                className="jm-panel"
              >
                <header className="jm-section-heading">
                  <div>
                    <h3>Tasks</h3>
                    <p>
                      {data.tasks.filter((t) => t.completed).length} of{" "}
                      {data.tasks.length} complete
                    </p>
                  </div>
                  {canEdit && !closed && (
                    <div className="jm-inline-actions">
                      <button
                        type="button"
                        className="secondary-button compact"
                        onClick={() => setTemplates(true)}
                      >
                        Templates
                      </button>
                      <button
                        type="button"
                        className="primary-button compact"
                        onClick={() => setTaskEditor("new")}
                      >
                        + Add task
                      </button>
                    </div>
                  )}
                </header>
                <JobTaskList
                  tasks={data.tasks}
                  team={team}
                  zone={zone}
                  canEdit={canEdit && !closed}
                  busy={busy}
                  onToggle={(task, completed) =>
                    void run(
                      () =>
                        manageJobWorkspace(
                          business.id,
                          jobId,
                          "complete_task",
                          { id: task.id, version: task.version, completed },
                        ),
                      "Task updated.",
                    )
                  }
                  onEdit={setTaskEditor}
                  onRemove={(task) => {
                    if (confirm("Remove this task?"))
                      void run(
                        () =>
                          manageJobWorkspace(
                            business.id,
                            jobId,
                            "remove_task",
                            { id: task.id, version: task.version },
                          ),
                        "Task removed.",
                      );
                  }}
                />
                {!data.tasks.length && (
                  <p className="quiet">
                    Add individual tasks or apply a saved checklist template.
                  </p>
                )}
              </div>
              <div
                role="tabpanel"
                id={tab("schedule") + "-panel"}
                aria-labelledby={compactSections ? undefined : tab("schedule") + "-tab"}
                aria-label={compactSections ? sectionLabels["schedule"] : undefined}
                hidden={!showPanel("schedule")}
                className="jm-panel"
              >
                <header className="jm-section-heading">
                  <div>
                    <h3>Schedule &amp; Crew</h3>
                    <p>
                      Appointments and worker assignments use the existing
                      calendar.
                    </p>
                  </div>
                  {canSchedule && !closed && (
                    <div className="jm-inline-actions">
                      <button
                        type="button"
                        className="secondary-button compact"
                        onClick={() => setDispatch("crew")}
                      >
                        Assign crew
                      </button>
                      {canBill && data.source_estimate && (
                        <button
                          type="button"
                          className="secondary-button compact"
                          onClick={() => setBookingOptions(true)}
                        >
                          Customer booking options
                        </button>
                      )}
                      <button
                        type="button"
                        className="primary-button compact"
                        onClick={() => setDispatch("appointment")}
                      >
                        {booked
                          ? "Reschedule next visit"
                          : "Schedule next visit"}
                      </button>
                    </div>
                  )}
                </header>
                {data.calendar_access ? (
                  <JobVisits
                    business={business}
                    jobId={jobId}
                    visits={data.visits}
                    tasks={data.tasks}
                    team={team}
                    canEdit={canSchedule}
                    closed={closed}
                    onSaved={changed}
                  />
                ) : (
                  <p>
                    Calendar access is required to view visits. Contact the
                    business owner.
                  </p>
                )}
              </div>
              <div
                role="tabpanel"
                id={tab("materials") + "-panel"}
                aria-labelledby={compactSections ? undefined : tab("materials") + "-tab"}
                aria-label={compactSections ? sectionLabels["materials"] : undefined}
                hidden={!showPanel("materials")}
                className="jm-panel"
              >
                <header className="jm-section-heading">
                  <div>
                    <h3>Materials</h3>
                    <p>Needed → Ordered → Received → Used</p>
                  </div>
                  {canEdit && !closed && (
                    <button
                      type="button"
                      className="primary-button compact"
                      onClick={() => setMaterialEditor("new")}
                    >
                      + Add material
                    </button>
                  )}
                </header>
                <ul className="jm-lines">
                  {data.materials.map((m) => (
                    <li key={m.id}>
                      <div>
                        <strong>{m.name}</strong>
                        <small>
                          {Number(m.quantity)} {m.unit}
                          {m.supplier ? " · " + m.supplier : ""}
                        </small>
                        {data.financial_access && m.estimated_cost != null && (
                          <small>
                            Estimated total {money(Number(m.estimated_cost))}
                          </small>
                        )}
                      </div>
                      <div className="jm-inline-actions">
                        <span
                          className={
                            "jm-status " +
                            (m.status === "needed" ? "is-warning" : "")
                          }
                        >
                          {materialLabels[m.status]}
                        </span>
                        {canEdit && !closed && (
                          <>
                            <button
                              type="button"
                              className="secondary-button compact"
                              disabled={busy}
                              aria-label={"Edit " + m.name}
                              onClick={() => setMaterialEditor(m)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              disabled={busy}
                              aria-label={"Remove " + m.name}
                              onClick={() => {
                                if (
                                  confirm(
                                    "Remove this material? Recorded expenses remain.",
                                  )
                                )
                                  void run(
                                    () =>
                                      manageJobManagement(
                                        business.id,
                                        jobId,
                                        "remove_material",
                                        { id: m.id, version: m.version },
                                      ),
                                    "Material removed.",
                                  );
                              }}
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {!data.materials.length && (
                  <p>
                    No materials recorded. Add supplies to track what needs
                    ordering or bringing to the site.
                  </p>
                )}
                <p className="quiet">
                  Material estimates are planning figures. Record purchases in
                  Photos &amp; Expenses once to include them in actual job
                  costs.
                </p>
              </div>
              <div
                role="tabpanel"
                id={tab("photos") + "-panel"}
                aria-labelledby={compactSections ? undefined : tab("photos") + "-tab"}
                aria-label={compactSections ? sectionLabels["photos"] : undefined}
                hidden={!showPanel("photos")}
                className="jm-panel"
              >
                {photosOpened && (
                  <RecordResources
                    business={business}
                    target={{ kind: "job", id: jobId }}
                    active={section === "photos"}
                  />
                )}
              </div>
              {canBill && (
                <div
                  role="tabpanel"
                  id={tab("changes") + "-panel"}
                  aria-labelledby={compactSections ? undefined : tab("changes") + "-tab"}
                aria-label={compactSections ? sectionLabels["changes"] : undefined}
                  hidden={!showPanel("changes")}
                  className="jm-panel"
                >
                  {section === "changes" &&
                    (changeSource ? (
                      <>
                        <label>
                          Document scope
                          <select
                            value={
                              selectedChangeDocument?.kind +
                              ":" +
                              selectedChangeDocument?.id
                            }
                            onChange={(e) => setChangeDocument(e.target.value)}
                          >
                            {changeDocuments.map((d) => (
                              <option
                                key={d.kind + ":" + d.id}
                                value={d.kind + ":" + d.id}
                              >
                                {d.number}
                              </option>
                            ))}
                          </select>
                        </label>
                        <DocumentChangeOrders
                          key={
                            changeSource.documentType + changeSource.documentId
                          }
                          business={business}
                          context={changeSource}
                          allowNew={canEdit && !closed}
                          onOpen={setChangeOrder}
                        />
                        {!!data.changes?.length && (
                          <>
                            <h3>All job changes</h3>
                            <ul className="jm-lines">
                              {data.changes.map((c) => (
                                <li key={c.id}>
                                  <div>
                                    <strong>{c.number || c.title}</strong>
                                    <small>
                                      {changeOrderStatusLabel(c.status)} ·{" "}
                                      {money(Number(c.total))}
                                      {[
                                        "add_to_draft",
                                        "create_invoice",
                                        "verify_existing",
                                        "manual_review",
                                      ].includes(c.billing_action || "")
                                        ? " · Billing review needed"
                                        : ""}
                                    </small>
                                  </div>
                                  <button
                                    type="button"
                                    className="secondary-button compact"
                                    onClick={() => {
                                      if (c.source_invoice_id)
                                        setChangeDocument(
                                          "invoice:" + c.source_invoice_id,
                                        );
                                      else if (c.estimate_id)
                                        setChangeDocument(
                                          "estimate:" + c.estimate_id,
                                        );
                                      setChangeOrder(c.id);
                                    }}
                                  >
                                    Review change
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <h3>Change orders</h3>
                        <p>
                          Create the original estimate or invoice before
                          proposing a change to its approved scope.
                        </p>
                        <a
                          className="secondary-button"
                          href={"/?view=invoices&job=" + jobId}
                        >
                          Add charges &amp; invoice
                        </a>
                      </>
                    ))}
                </div>
              )}
              {canBill && (
                <div
                  role="tabpanel"
                  id={tab("billing") + "-panel"}
                  aria-labelledby={compactSections ? undefined : tab("billing") + "-tab"}
                aria-label={compactSections ? sectionLabels["billing"] : undefined}
                  hidden={!showPanel("billing")}
                  className="jm-panel"
                >
                  <div hidden={compactSections && mobileBilling === "costs"}>
                  <header className="jm-section-heading">
                    <div>
                      <h3>Billing &amp; job costs</h3>
                      <p>
                        Work completion, document approval and payment remain
                        separate.
                      </p>
                    </div>
                    {closed &&
                      job.status === "completed" &&
                      !billingInvoice && (
                        <button
                          type="button"
                          className="primary-button compact"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const result = await completeJob(jobId, true);
                              setInvoiceAction(jobInvoiceAction(result));
                            }, "Invoice preparation checked. Review the next step below.")
                          }
                        >
                          Prepare invoice
                        </button>
                      )}
                  </header>
                  {data.source_estimate && (
                    <p>
                      <a
                        href={
                          "/?view=estimates&document=" + data.source_estimate.id
                        }
                      >
                        Open{" "}
                        {data.source_estimate.number || "approved estimate"}
                      </a>{" "}
                      ·{" "}
                      {approvedValue === null
                        ? "Original estimate"
                        : "Approved scope"}{" "}
                      {money(
                        approvedValue ?? Number(data.source_estimate.total),
                      )}
                    </p>
                  )}
                  <dl className="jm-financial-lines">
                    <div>
                      <dt>Deposit received</dt>
                      <dd>{money(depositPaid)}</dd>
                    </div>
                    <div>
                      <dt>Issued invoice balance</dt>
                      <dd>{money(balance)}</dd>
                    </div>
                  </dl>
                  <ul className="jm-lines">
                    {data.documents?.map((i) => (
                      <li key={i.id}>
                        <div>
                          <a href={"/?view=invoices&document=" + i.id}>
                            {i.number || "Draft invoice"}
                          </a>
                          <small>
                            {i.deposit ? "Deposit · " : ""}
                            {i.status.replaceAll("_", " ")} · Total{" "}
                            {money(Number(i.total))}
                          </small>
                        </div>
                        <strong>
                          {i.status === "void"
                            ? "Voided"
                            : (i.status === "draft"
                                ? "Draft balance "
                                : "Balance ") + money(Number(i.balance_due))}
                        </strong>
                      </li>
                    ))}
                  </ul>
                  {!data.documents?.length && (
                    <p>
                      No linked invoices yet. Completing the job prepares its
                      billing for office review.
                    </p>
                  )}
                  </div>
                  {data.financial_access && costsOpened && (!compactSections || mobileBilling === "costs") && (
                    <>
                      <JobWorkPlan
                        business={business}
                        jobId={jobId}
                        team={team}
                        canEdit={canEdit}
                        closed={closed}
                        section="costs"
                      />
                      <JobCostReview
                        business={business}
                        jobId={jobId}
                        team={team}
                        onSaved={changed}
                      />
                    </>
                  )}
                </div>
              )}
              <div
                role="tabpanel"
                id={tab("reports") + "-panel"}
                aria-labelledby={compactSections ? undefined : tab("reports") + "-tab"}
                aria-label={compactSections ? sectionLabels["reports"] : undefined}
                hidden={!showPanel("reports")}
                className="jm-panel"
              >
                {section === "reports" && (
                  <JobCompletionReports
                    business={business}
                    jobId={jobId}
                    completed={job.status === "completed"}
                    canEdit={canEdit && canSchedule}
                    onSaved={changed}
                  />
                )}
              </div>
              <div
                role="tabpanel"
                id={tab("activity") + "-panel"}
                aria-labelledby={compactSections ? undefined : tab("activity") + "-tab"}
                aria-label={compactSections ? sectionLabels["activity"] : undefined}
                hidden={!showPanel("activity")}
                className="jm-panel"
              >
                <h3>Activity history</h3>
                <p className="quiet">
                  The latest 50 work-plan and job changes.
                </p>
                <Activity entries={data.activity} zone={zone} />
              </div>
            </>
          )}
          <footer className="jm-workspace-footer">
            <RecordMoreMenu label="Job actions" disabled={busy}>
              {compactSections && action === 'complete' && step.action !== 'complete' && <button type="button" disabled={busy||!data||loading||!!error} onClick={reviewCompletion}>Review completion</button>}
              {canEdit && !closed && (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        "Cancel this job and remove its active schedule? Its records remain in History.",
                      )
                    )
                      void run(
                        () => updateJobStatus(jobId, "canceled"),
                        "Job canceled. Records remain in history.",
                      );
                  }}
                >
                  Cancel job
                </button>
              )}
              {canSchedule && closed && (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        "Reopen this job for more work? Existing visits and invoices remain.",
                      )
                    )
                      void run(async () => {
                        await reopenJob(jobId, reopenRequest.current);
                        reopenRequest.current = crypto.randomUUID();
                        setDispatch("appointment");
                      }, "Job reopened. Review and save its next appointment.");
                  }}
                >
                  Reopen job
                </button>
              )}
              <button type="button" onClick={() => setDetails(true)}>
                Open full job details
              </button>
            </RecordMoreMenu>
          </footer>
        </>
      )}
      {taskEditor && (
        <TaskEditor
          business={business}
          jobId={jobId}
          task={taskEditor === "new" ? undefined : taskEditor}
          visits={data?.visits || []}
          team={team}
          onSaved={changed}
          onClose={() => setTaskEditor(null)}
        />
      )}
      {materialEditor && data && (
        <MaterialEditor
          business={business}
          jobId={jobId}
          material={materialEditor === "new" ? undefined : materialEditor}
          financial={data.financial_access}
          onSaved={changed}
          onClose={() => setMaterialEditor(null)}
        />
      )}
      {templates && data && (
        <ChecklistTemplates
          business={business}
          jobId={jobId}
          data={data}
          onSaved={changed}
          onClose={() => setTemplates(false)}
        />
      )}
      {details && (
        <JobDetailsDialog
          business={business}
          jobId={jobId}
          onUpdated={changed}
          onClose={() => {
            setDetails(false);
            changed();
          }}
        />
      )}
      {bookingOptions && data?.source_estimate && (
        <Suspense fallback={<p role="status">Loading booking options…</p>}>
          <ScheduleEstimateDialog
            business={business}
            estimateId={data.source_estimate.id}
            initialMode="offer"
            onSaved={changed}
            onClose={() => setBookingOptions(false)}
          />
        </Suspense>
      )}
      {dispatch && job && (
        <DispatchJobDialog
          key={dispatch}
          business={business}
          job={job}
          mode={dispatch}
          needsAppointmentRepair={!booked}
          onReschedule={() => setDispatch("appointment")}
          onSaved={changed}
          onClose={() => setDispatch(null)}
        />
      )}
      {completion && data && job && (
        <FormDialog
          label="Complete job review"
          busy={busy}
          onClose={() => setCompletion(false)}
        >
          <header className="modal-head">
            <h2>Review before completing</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Close completion review"
              onClick={() => setCompletion(false)}
            >
              ×
            </button>
          </header>
          <p>
            <strong>{job.title}</strong>
          </p>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          {remainingVisits && (
            <p role="alert" className="provider-status-note">
              Finish or cancel the remaining visits in Schedule &amp; Crew
              before completing this job.
            </p>
          )}
          <ul className="jm-completion-list">
            <li>{outstandingTasks.length} unfinished tasks</li>
            <li>
              {missingMaterials.length}{" "}
              {missingMaterials.length === 1 ? "material" : "materials"} not
              received
            </li>
            <li>{pendingChanges.length} draft or pending changes</li>
            <li>
              {unbilledChanges.length} approved changes need billing review
            </li>
            <li>
              {data.financial_access
                ? money(costs) +
                  " recorded costs; confirm all receipts and labor are entered."
                : "Ask the office to check recorded costs and billing."}
            </li>
            {Number(data.pending_time_minutes) > 0 && (
              <li>
                {(Number(data.pending_time_minutes) / 60).toFixed(2)} field
                hours await office review and are excluded from actual costs.
              </li>
            )}
            {uncostedHours > 0 && (
              <li>{uncostedHours.toFixed(2)} labor hours have no cost rate.</li>
            )}
            <li>
              {finalDocuments.length
                ? "Linked invoice will remain available for review."
                : "Billing will need an invoice review."}
            </li>
          </ul>
          <p>
            Completing the job prepares billing for office review. No invoice is
            sent and no payment is recorded.
          </p>
          {completeWarnings > 0 && (
            <label className="jm-confirm">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I reviewed the unfinished work, materials and changes and want to
              complete this job.
            </label>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setCompletion(false)}
            >
              Keep working
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={
                busy || remainingVisits || (completeWarnings > 0 && !reviewed)
              }
              onClick={() => void complete()}
            >
              Complete job
            </button>
          </div>
        </FormDialog>
      )}
    </section>
  );
}
function Activity({
  entries,
  zone,
}: {
  entries: JobManagementData["activity"];
  zone: string;
}) {
  return entries.length ? (
    <ol className="jm-activity">
      {entries.map((a) => (
        <li key={a.id}>
          <strong>{a.event}</strong>
          <small>
            {a.actor || "Team"} ·{" "}
            <time dateTime={a.created_at}>
              {DateTime.fromISO(a.created_at)
                .setZone(zone)
                .toFormat("MMM d, yyyy · h:mm a")}
            </time>
          </small>
        </li>
      ))}
    </ol>
  ) : (
    <p className="quiet">Job activity will appear here as work is recorded.</p>
  );
}
