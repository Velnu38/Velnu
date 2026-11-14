import { useRef, useState, type FormEvent } from "react";
import { DateTime } from "luxon";
import type { CurrentBusiness } from "../lib/business";
import type { Worker } from "../services/schedulingWorkflow";
import { manageJobWorkspace, type JobTask } from "../services/operations";
import {
  manageJobManagement,
  type JobManagementData,
  type JobMaterial,
} from "../services/jobManagement";
import FormDialog from "./FormDialog";
export const materialLabels = {
  needed: "Needed",
  ordered: "Ordered",
  received: "Received",
  used: "Used",
};
export function TaskEditor({
  business,
  jobId,
  task,
  team,
  visits = [],
  onSaved,
  onClose,
}: {
  business: CurrentBusiness;
  jobId: string;
  task?: JobTask;
  team: Worker[];
  visits?: import("../services/jobExecution").JobVisit[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
      title: task?.title || "",
      visit_id: task?.visit_id || "",
      worker_id: task?.worker_id || "",
      due_on: task?.due_on || "",
      priority: task?.priority || "normal",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false),
    id = useRef(task?.id || crypto.randomUUID());
  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (task)
        await manageJobManagement(business.id, jobId, "edit_task", {
          ...form,
          id: task.id,
          version: task.version,
        });
      else
        await manageJobWorkspace(business.id, jobId, "add_task", {
          ...form,
          id: id.current,
        });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message || "Unable to save task.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <FormDialog
      label={task ? "Edit task" : "Add task"}
      busy={busy}
      onClose={onClose}
    >
      <header className="modal-head">
        <h2>{task ? "Edit task" : "Add task"}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close task"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <form className="form-grid" onSubmit={save}>
        <label className="full">
          Work to complete
          <input
            required
            maxLength={240}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
        <label>
          Assigned worker
          <select
            value={form.worker_id}
            onChange={(e) => setForm({ ...form, worker_id: e.target.value })}
          >
            <option value="">Unassigned</option>
            {team
              .filter((w) => w.active !== false || w.id === form.worker_id)
              .map((w) => (
                <option key={w.id} value={w.id} disabled={w.active === false}>
                  {w.label}
                  {w.active === false ? " (inactive)" : ""}
                </option>
              ))}
          </select>
        </label>
        <label>
          Visit (optional)
          <select
            value={form.visit_id}
            onChange={(e) => setForm({ ...form, visit_id: e.target.value })}
          >
            <option value="">Whole job</option>
            {visits.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title || "Visit"} ·{" "}
                {DateTime.fromISO(v.starts_at).toFormat("MMM d")} ·{" "}
                {v.status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due date
          <input
            type="date"
            value={form.due_on}
            onChange={(e) => setForm({ ...form, due_on: e.target.value })}
          />
        </label>
        <label>
          Priority
          <select
            value={form.priority}
            onChange={(e) =>
              setForm({
                ...form,
                priority: e.target.value as "low" | "normal" | "high",
              })
            }
          >
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="low">Low</option>
          </select>
        </label>
        <p className="quiet full">
          Task assignment records responsibility. It does not grant account
          access or send a message.
        </p>
        {error && (
          <p role="alert" className="error-text full">
            {error}
          </p>
        )}
        <div className="modal-actions full">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={busy || !form.title.trim()}
          >
            Save task
          </button>
        </div>
      </form>
    </FormDialog>
  );
}
export function MaterialEditor({
  business,
  jobId,
  material,
  financial,
  onSaved,
  onClose,
}: {
  business: CurrentBusiness;
  jobId: string;
  material?: JobMaterial;
  financial: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
      name: material?.name || "",
      quantity: String(material?.quantity ?? 1),
      unit: material?.unit || "",
      supplier: material?.supplier || "",
      status: material?.status || "needed",
      estimated_cost:
        material?.estimated_cost == null ? "" : String(material.estimated_cost),
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false),
    id = useRef(material?.id || crypto.randomUUID());
  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const { estimated_cost, ...rest } = form;
      await manageJobManagement(business.id, jobId, "save_material", {
        ...rest,
        id: id.current,
        version: material?.version || 0,
        quantity: Number(form.quantity),
        ...(financial
          ? {
              estimated_cost:
                estimated_cost === "" ? null : Number(estimated_cost),
            }
          : {}),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message || "Unable to save material.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <FormDialog
      label={material ? "Edit material" : "Add material"}
      busy={busy}
      onClose={onClose}
    >
      <header className="modal-head">
        <h2>{material ? "Edit material" : "Add material"}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close material"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <form className="form-grid" onSubmit={save}>
        <label className="full">
          Material
          <input
            required
            maxLength={240}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          Quantity
          <input
            type="number"
            required
            min="0.001"
            max="1000000"
            step="0.001"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
        </label>
        <label>
          Unit
          <input
            maxLength={40}
            placeholder="bags, boxes, feet…"
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
          />
        </label>
        <label>
          Supplier
          <input
            maxLength={160}
            value={form.supplier}
            onChange={(e) => setForm({ ...form, supplier: e.target.value })}
          />
        </label>
        <label>
          Status
          <select
            value={form.status}
            onChange={(e) =>
              setForm({
                ...form,
                status: e.target.value as JobMaterial["status"],
              })
            }
          >
            {Object.entries(materialLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {financial && (
          <label className="full">
            Estimated total cost ($)
            <input
              type="number"
              min="0"
              max="100000000"
              step="0.01"
              value={form.estimated_cost}
              onChange={(e) =>
                setForm({ ...form, estimated_cost: e.target.value })
              }
            />
          </label>
        )}
        <p className="quiet full">
          Track supplies here. Record the actual purchase once in Photos &amp;
          Expenses; changing this list does not post an expense or customer
          charge.
        </p>
        {error && (
          <p role="alert" className="error-text full">
            {error}
          </p>
        )}
        <div className="modal-actions full">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={busy || !form.name.trim()}
          >
            Save material
          </button>
        </div>
      </form>
    </FormDialog>
  );
}
export function ChecklistTemplates({
  business,
  jobId,
  data,
  onSaved,
  onClose,
}: {
  business: CurrentBusiness;
  jobId: string;
  data: JobManagementData;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null),
    saving = useRef(false);
  const office = ["owner", "admin", "office"].includes(business.role);
  async function run(
    action: string,
    payload: Record<string, unknown>,
    key: string,
  ) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    if (request.current?.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    try {
      await manageJobManagement(business.id, jobId, action, {
        ...payload,
        ...(action === "save_template"
          ? { id: request.current.id }
          : action === "apply_template"
            ? { request_id: request.current.id }
            : {}),
      });
      request.current = null;
      onSaved();
      if (action === "remove_template") setName("");
      else onClose();
    } catch (e) {
      setError((e as Error).message || "Template could not be saved.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <FormDialog label="Checklist templates" busy={busy} onClose={onClose}>
      <header className="modal-head">
        <h2>Checklist templates</h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Close templates"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <p className="quiet">
        Apply reusable steps to this job. New tasks start incomplete, with no
        worker or due date.
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <ul className="jm-lines">
        {data.templates.map((t) => (
          <li key={t.id}>
            <div>
              <strong>{t.name}</strong>
              <small>{t.count} tasks</small>
            </div>
            <div className="jm-inline-actions">
              <button
                type="button"
                className="secondary-button compact"
                disabled={busy}
                onClick={() =>
                  void run(
                    "apply_template",
                    { template_id: t.id },
                    "apply:" + t.id,
                  )
                }
              >
                Apply
              </button>
              {office && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "Remove this shared template? Existing job tasks remain.",
                      )
                    )
                      void run(
                        "remove_template",
                        { id: t.id },
                        "remove:" + t.id,
                      );
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!data.templates.length && <p>No saved templates yet.</p>}
      {office && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run("save_template", { name }, "save:" + name);
          }}
        >
          <fieldset disabled={busy || !data.tasks.length}>
            <legend>Save this job’s checklist as a template</legend>
            <label>
              Template name
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button className="primary-button" disabled={!name.trim()}>
              Save template
            </button>
          </fieldset>
        </form>
      )}
    </FormDialog>
  );
}
export function JobTaskList({
  tasks,
  team,
  zone,
  canEdit,
  busy,
  collapseCompleted = false,
  onToggle,
  onEdit,
  onRemove,
}: {
  tasks: JobTask[];
  team: Worker[];
  zone: string;
  canEdit: boolean;
  busy: boolean;
  collapseCompleted?: boolean;
  onToggle: (task: JobTask, completed: boolean) => void;
  onEdit: (task: JobTask) => void;
  onRemove: (task: JobTask) => void;
}) {
  const today = DateTime.now().setZone(zone).toISODate()!;
  const sorted=[...tasks].sort((a,b)=>Number(a.completed)-Number(b.completed)||Number(b.priority==='high')-Number(a.priority==='high')||(a.due_on||'9999').localeCompare(b.due_on||'9999'));
  const renderTask=(t:JobTask)=>(
          <li key={t.id}>
            <label>
              <input
                type="checkbox"
                checked={t.completed}
                disabled={busy || !canEdit}
                onChange={(e) => onToggle(t, e.target.checked)}
              />
              <span className={t.completed ? "is-done" : ""}>
                {t.title}
                <small>
                  {team.find((w) => w.id === t.worker_id)?.label ||
                    (t.worker_id ? "Worker unavailable" : "Unassigned")}
                  {t.due_on
                    ? " · Due " +
                      DateTime.fromISO(t.due_on).toFormat("MMM d, yyyy")
                    : ""}
                </small>
                {!t.completed && t.due_on && t.due_on < today && (
                  <small className="jm-overdue">Overdue</small>
                )}
                {t.priority === "high" && (
                  <small className="jm-overdue">High priority</small>
                )}
              </span>
            </label>
            {canEdit && (
              <div className="jm-inline-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  aria-label={"Edit " + t.title}
                  onClick={() => onEdit(t)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  aria-label={"Remove " + t.title}
                  onClick={() => onRemove(t)}
                >
                  Remove
                </button>
              </div>
            )}
          </li>);
  return <>
    <ul className="job-checklist jm-task-list">{sorted.filter(t=>!collapseCompleted||!t.completed).map(renderTask)}</ul>
    {collapseCompleted && sorted.some(t=>t.completed) && <details className="jm-completed-tasks"><summary>Completed tasks ({sorted.filter(t=>t.completed).length})</summary><ul className="job-checklist jm-task-list">{sorted.filter(t=>t.completed).map(renderTask)}</ul></details>}
  </>;
}
