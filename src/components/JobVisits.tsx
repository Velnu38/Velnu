import { useRef, useState, type FormEvent } from "react";
import { DateTime } from "luxon";
import type { CurrentBusiness } from "../lib/business";
import type { Worker } from "../services/schedulingWorkflow";
import { manageJobVisit, type JobVisit } from "../services/jobExecution";
import type { JobTask } from "../services/operations";
import FormDialog from "./FormDialog";
export default function JobVisits({
  business,
  jobId,
  visits,
  tasks,
  team,
  canEdit,
  closed,
  onSaved,
}: {
  business: CurrentBusiness;
  jobId: string;
  visits: JobVisit[];
  tasks: JobTask[];
  team: Worker[];
  canEdit: boolean;
  closed: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState<JobVisit | "new" | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false),
    zone = business.timezone || "America/New_York";
  async function change(v: JobVisit, action: string) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await manageJobVisit(business.id, jobId, action, {
        id: v.id,
        version: v.version,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const active = visits.filter((v) =>
      ["scheduled", "confirmed", "in_progress"].includes(v.status),
    ),
    history = visits.filter((v) => !active.includes(v));
  function list(rows: JobVisit[]) {
    return (
      <ul className="jm-lines jm-visit-list">
        {rows.map((v) => (
          <li key={v.id}>
            <div>
              <strong>{v.title || "Job visit"}</strong>
              <span>
                {DateTime.fromISO(v.starts_at)
                  .setZone(zone)
                  .toFormat("EEE, MMM d, yyyy · h:mm a")}
                {v.ends_at
                  ? " – " +
                    DateTime.fromISO(v.ends_at).setZone(zone).toFormat("h:mm a")
                  : ""}
              </span>
              <small>
                {v.status.replaceAll("_", " ")} ·{" "}
                {(v.worker_ids || [])
                  .map(
                    (w) =>
                      team.find((t) => t.id === w)?.label ||
                      "Worker unavailable",
                  )
                  .join(", ") || "Crew unassigned"}
              </small>
              <small>
                {tasks.filter((t) => t.visit_id === v.id && t.completed).length}{" "}
                of {tasks.filter((t) => t.visit_id === v.id).length} visit tasks
                complete
              </small>
            </div>
            {canEdit && !closed && active.includes(v) && (
              <div className="jm-inline-actions">
                <button
                  type="button"
                  className="secondary-button compact"
                  disabled={busy}
                  onClick={() => setEditing(v)}
                >
                  Edit visit
                </button>
                {Date.parse(v.starts_at) <= Date.now() && (
                  <>
                    <button
                      type="button"
                      className="secondary-button compact"
                      disabled={busy || v.status === "in_progress"}
                      onClick={() => void change(v, "start")}
                    >
                      Start visit
                    </button>
                    <button
                      type="button"
                      className="secondary-button compact"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Finish this visit? The job stays open and any later visit stays scheduled.",
                          )
                        )
                          void change(v, "finish");
                      }}
                    >
                      Finish visit
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "Cancel this visit? Other visits and job records will be retained.",
                      )
                    )
                      void change(v, "cancel");
                  }}
                >
                  Cancel visit
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <section aria-label="Job visits">
      <header className="jm-section-heading">
        <div>
          <h3>Planned visits</h3>
          <p>
            {active.length} open · Times shown in {zone.replaceAll("_", " ")}
          </p>
        </div>
        {canEdit && !closed && (
          <button
            type="button"
            className="primary-button compact"
            onClick={() => setEditing("new")}
          >
            + Plan visit
          </button>
        )}
      </header>
      <p className="quiet">
        Plan each return visit with its own crew. Add tasks to a visit from the
        Tasks tab. Saving a visit updates the calendar.
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {active.length ? (
        list(active)
      ) : (
        <p>No open visits. Plan the next visit when ready.</p>
      )}
      {history.length > 0 && (
        <details>
          <summary>Visit history ({history.length})</summary>
          {list(history)}
        </details>
      )}
      {editing && (
        <VisitEditor
          business={business}
          jobId={jobId}
          team={team}
          visit={editing === "new" ? undefined : editing}
          onSaved={onSaved}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
function VisitEditor({
  business,
  jobId,
  team,
  visit,
  onSaved,
  onClose,
}: {
  business: CurrentBusiness;
  jobId: string;
  team: Worker[];
  visit?: JobVisit;
  onSaved: () => void;
  onClose: () => void;
}) {
  const zone = business.timezone || "America/New_York",
    local = (s?: string | null) =>
      s ? DateTime.fromISO(s).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm") : "";
  const [form, setForm] = useState({
      title: visit?.title || "Service visit",
      starts_at: local(visit?.starts_at),
      ends_at: local(visit?.ends_at),
      workers: visit?.worker_ids || ([] as string[]),
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const id = useRef(visit?.id || crypto.randomUUID()),
    saving = useRef(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const s = DateTime.fromISO(form.starts_at, { zone }),
        end = DateTime.fromISO(form.ends_at, { zone });
      if (!s.isValid || !end.isValid || end <= s)
        throw Error("Choose valid start and end times.");
      await manageJobVisit(business.id, jobId, "save", {
        ...form,
        id: id.current,
        version: visit?.version || 0,
        starts_at: s.toUTC().toISO(),
        ends_at: end.toUTC().toISO(),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <FormDialog
      label={visit ? "Edit visit" : "Plan a visit"}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={save}>
        <h2>{visit ? "Edit visit" : "Plan a visit"}</h2>
        <div className="form-grid">
          <label className="full">
            Visit title
            <input
              required
              maxLength={160}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label>
            Starts
            <input
              required
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
            />
          </label>
          <label>
            Ends
            <input
              required
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
            />
          </label>
          <fieldset className="full jm-visit-crew">
            <legend>Crew for this visit</legend>
            {team
              .filter((w) => w.active !== false || form.workers.includes(w.id))
              .map((w) => (
                <label key={w.id}>
                  <input
                    type="checkbox"
                    checked={form.workers.includes(w.id)}
                    disabled={w.active === false}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        workers: e.target.checked
                          ? [...form.workers, w.id]
                          : form.workers.filter((id) => id !== w.id),
                      })
                    }
                  />
                  {w.label}
                  {w.active === false ? " (inactive)" : ""}
                </label>
              ))}
          </fieldset>
          <p className="quiet full">
            {zone.replaceAll("_", " ")} · Worker availability and overlapping
            bookings are checked when saved.
          </p>
          {error && (
            <p role="alert" className="error-text full">
              {error}
            </p>
          )}
          <div className="modal-actions full">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="primary-button" disabled={busy}>
              {busy ? "Saving…" : "Save visit"}
            </button>
          </div>
        </div>
      </form>
    </FormDialog>
  );
}
