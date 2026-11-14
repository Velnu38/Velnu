import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CurrentBusiness } from "../lib/business";
import type { Worker } from "../services/schedulingWorkflow";
import { getJobWorkspace, type JobTime } from "../services/operations";
import {
  getCostReview,
  manageCostReview,
  type CostReview,
} from "../services/jobExecution";
import FormDialog from "./FormDialog";
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n,
  );
export default function JobCostReview({
  business,
  jobId,
  team,
  onSaved,
}: {
  business: CurrentBusiness;
  jobId: string;
  team: Worker[];
  onSaved: () => void;
}) {
  const [data, setData] = useState<CostReview | null>(null),
    [time, setTime] = useState<JobTime[]>([]),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<{
      action: "approve_time" | "reject_time" | "rate" | "exclude_expense";
      id: string;
      version?: number;
      label: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const current = useRef(true);
  useEffect(() => {
    let active = true;
    current.current = true;
    setData(null);
    Promise.all([
      getCostReview(business.id, jobId),
      getJobWorkspace(business.id, jobId),
    ])
      .then(([d, w]) => {
        if (active) {
          setData(d);
          setTime(w.time || []);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      current.current = false;
    };
  }, [business.id, jobId, revision]);
  const worker = (id: string | null) =>
    team.find((w) => w.id === id)?.label || "Unassigned worker";
  async function restore(id: string) {
    setBusy(true);
    setError("");
    try {
      await manageCostReview(business.id, jobId, "include_expense", { id });
      if (current.current) {
        setRevision((v) => v + 1);
        onSaved();
      }
    } catch (e) {
      if (current.current) setError((e as Error).message);
    } finally {
      if (current.current) setBusy(false);
    }
  }
  return (
    <section className="jm-cost-review" aria-label="Cost review">
      <header className="jm-section-heading">
        <div>
          <h3>Cost review</h3>
          <p>Review field hours, missing rates and possible duplicate costs.</p>
        </div>
        <button
          type="button"
          className="secondary-button compact"
          disabled={busy}
          onClick={() => setRevision((v) => v + 1)}
          aria-label="Refresh cost review"
        >
          ↻ Refresh
        </button>
      </header>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading cost review…</p>}
      {data && (
        <>
          <h4>Submitted time awaiting review ({data.pending_time.length})</h4>
          <ul className="jm-lines">
            {data.pending_time.map((t) => (
              <li key={t.id}>
                <div>
                  <strong>
                    {worker(t.worker_id)} · {t.minutes} minutes
                  </strong>
                  <small>
                    {t.worked_on} · {t.note || "No work note"}
                  </small>
                </div>
                <div className="jm-inline-actions">
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() =>
                      setEditing({
                        action: "approve_time",
                        id: t.id,
                        version: t.version,
                        label:
                          worker(t.worker_id) + " · " + t.minutes + " minutes",
                      })
                    }
                  >
                    Review & post
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setEditing({
                        action: "reject_time",
                        id: t.id,
                        version: t.version,
                        label:
                          worker(t.worker_id) + " · " + t.minutes + " minutes",
                      })
                    }
                  >
                    Return time
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {!data.pending_time.length && (
            <p className="quiet">No submitted hours awaiting review.</p>
          )}
          <details className="work-plan-section">
            <summary>Recorded labor rates ({time.length})</summary>
            <p className="quiet">
              A zero rate leaves labor uncosted. Changing an internal rate
              updates job costing and keeps its activity history.
            </p>
            <ul className="jm-lines">
              {time.map((t) => (
                <li key={t.id}>
                  <div>
                    <strong>
                      {worker(t.worker_id)} · {t.minutes} minutes
                    </strong>
                    <small>
                      {t.worked_on} · {money(Number(t.hourly_cost))}/hour
                      {!Number(t.hourly_cost) ? " · Missing cost rate" : ""}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() =>
                      setEditing({
                        action: "rate",
                        id: t.id,
                        version: t.version || 1,
                        label: worker(t.worker_id) + " · " + t.worked_on,
                      })
                    }
                  >
                    Edit rate
                  </button>
                </li>
              ))}
            </ul>
          </details>
          {data.possible_duplicate_time.length > 0 && (
            <div className="provider-status-note">
              <strong>Review possible duplicate time</strong>
              {data.possible_duplicate_time.map((g, i) => (
                <p key={i}>
                  {worker(g.worker_id)} · {g.worked_on} · {g.entries} entries of{" "}
                  {g.minutes} minutes. Compare the work notes in Time &amp;
                  labor cost before removing any duplicate.
                </p>
              ))}
            </div>
          )}
          <details className="work-plan-section">
            <summary>Allocated expenses ({data.expenses.length})</summary>
            <p className="quiet">
              Each purchase is allocated once using its job or linked document.
              If labor is already counted in time, exclude the matching payment
              here with a reason. The bookkeeping transaction remains intact.
            </p>
            <ul className="jm-lines">
              {data.expenses.map((e) => (
                <li key={e.id}>
                  <div>
                    <strong>
                      {e.description || e.category || "Expense"} ·{" "}
                      {e.currency === "USD"
                        ? money(Number(e.amount))
                        : e.currency + " " + e.amount}
                    </strong>
                    <small>
                      {e.date} ·{" "}
                      {e.excluded
                        ? "Excluded: " + e.reason
                        : e.currency === "USD"
                          ? "Included in actual costs"
                          : "Excluded from USD costing; currency conversion required"}
                    </small>
                  </div>
                  {e.currency === "USD" &&
                    (e.excluded ? (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => void restore(e.id)}
                      >
                        Include cost
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          setEditing({
                            action: "exclude_expense",
                            id: e.id,
                            label: e.description || "Expense",
                          })
                        }
                      >
                        Exclude duplicate cost
                      </button>
                    ))}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      {editing && (
        <CostEditor
          key={editing.id + editing.action}
          business={business}
          jobId={jobId}
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setRevision((v) => v + 1);
            onSaved();
          }}
        />
      )}
    </section>
  );
}
function CostEditor({
  business,
  jobId,
  editing,
  onClose,
  onSaved,
}: {
  business: CurrentBusiness;
  jobId: string;
  editing: { action: string; id: string; version?: number; label: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rate, setRate] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    saving = useRef(false);
  const cost = ["approve_time", "rate"].includes(editing.action);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await manageCostReview(business.id, jobId, editing.action, {
        id: editing.id,
        version: editing.version,
        hourly_cost: cost ? Number(rate) : undefined,
        note,
        reason: note,
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
    <FormDialog label="Review job cost" busy={busy} onClose={onClose}>
      <form onSubmit={save}>
        <h2>
          {editing.action === "approve_time"
            ? "Review submitted time"
            : editing.action === "reject_time"
              ? "Return submitted time"
              : cost
                ? "Edit labor cost rate"
                : "Exclude duplicate cost"}
        </h2>
        <p>{editing.label}</p>
        {cost && (
          <label>
            Internal hourly cost ($)
            <input
              type="number"
              required
              min="0"
              max="10000"
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </label>
        )}
        <label>
          {cost ? "Office note (optional)" : "Reason (required)"}
          <textarea
            required={!cost}
            maxLength={cost ? 400 : 240}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {cost && Number(rate) === 0 && rate !== "" && (
          <p className="quiet">
            A zero cost rate will remain flagged for review.
          </p>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy
              ? "Saving…"
              : editing.action === "approve_time"
                ? "Post reviewed time"
                : "Save review"}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}
