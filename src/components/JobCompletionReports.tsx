import { useEffect, useRef, useState, type FormEvent } from "react";
import { DateTime } from "luxon";
import type { CurrentBusiness } from "../lib/business";
import {
  getJobReports,
  createJobReport,
  completionPhoto,
  type JobReport,
} from "../services/jobExecution";
import {
  listRecordPhotos,
  type RecordPhoto,
} from "../services/recordResources";
import { downloadDocumentPdf } from "../services/documentPdf";
import FormDialog from "./FormDialog";
const consent = "I acknowledge the work described in this completion report.";
export default function JobCompletionReports({
  business,
  jobId,
  completed,
  canEdit,
  onSaved,
}: {
  business: CurrentBusiness;
  jobId: string;
  completed: boolean;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [reports, setReports] = useState<JobReport[]>([]),
    [selected, setSelected] = useState(""),
    [editor, setEditor] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    getJobReports(business.id, jobId)
      .then((rows) => {
        if (active) {
          setReports(rows);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [business.id, jobId, revision]);
  const report = reports.find((r) => r.id === selected) || reports[0];
  async function download() {
    if (!report || busy) return;
    setBusy(true);
    setError("");
    try {
      const { generateJobCompletionPdf } = await import(
        "../../shared/jobCompletionPdf"
      );
      const bytes = await generateJobCompletionPdf(
        report.snapshot,
        completionPhoto,
      );
      downloadDocumentPdf({
        blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        filename:
          "Job-" +
          jobId.slice(0, 8) +
          "-Completion-v" +
          report.version +
          ".pdf",
        revisionId: report.id,
        etag: null,
      });
    } catch (e) {
      setError(
        (e as Error).message ||
          "The report PDF could not be created. Reconnect and retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Completion reports">
      <header className="jm-section-heading">
        <div>
          <h3>Completion report</h3>
          <p>
            A saved record of completed work, checklist, visits and selected job
            photos.
          </p>
        </div>
        {completed && canEdit && (
          <button
            type="button"
            className="primary-button compact"
            onClick={() => setEditor(true)}
          >
            + Create report version
          </button>
        )}
      </header>
      {!completed && (
        <p className="provider-status-note">
          Complete the job after finishing its visits to create a completion
          report. Earlier report versions remain available if the job is
          reopened.
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => setRevision((v) => v + 1)}
          >
            Retry reports
          </button>
        </p>
      )}
      {loading && <p role="status">Loading saved reports…</p>}
      {!loading && !reports.length && (
        <p>No completion report has been saved yet.</p>
      )}
      {report && (
        <>
          <div className="jm-inline-actions">
            <label>
              Saved report version
              <select
                value={report.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    Version {r.version} ·{" "}
                    {DateTime.fromISO(r.created_at)
                      .setZone(business.timezone || "America/New_York")
                      .toFormat("MMM d, yyyy · h:mm a")}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void download()}
            >
              {busy ? "Preparing PDF…" : "Download report PDF"}
            </button>
          </div>
          <article className="jm-report-preview">
            <p className="eyebrow">
              {report.snapshot.business.name} · Report v{report.version}
            </p>
            <h3>{report.snapshot.job.title}</h3>
            <p>
              {report.snapshot.job.customer} · {report.snapshot.job.address}
            </p>
            <h4>Work performed</h4>
            <p className="jm-preserve-lines">{report.snapshot.summary}</p>
            <h4>Checklist</h4>
            <ul>
              {report.snapshot.tasks.map((t, i) => (
                <li key={i}>
                  {t.completed ? "✓" : "○"} {t.title}
                </li>
              ))}
            </ul>
            <p>
              {report.snapshot.visits.length} visits ·{" "}
              {report.snapshot.photos.length} retained photos included in PDF
            </p>
            <h4>Customer acknowledgement</h4>
            {report.snapshot.signoff ? (
              <>
                <p>{report.snapshot.signoff.statement}</p>
                <strong>{report.snapshot.signoff.name}</strong>
                <p className="quiet">
                  {report.snapshot.signoff.method} ·{" "}
                  {DateTime.fromISO(report.snapshot.signoff.captured_at)
                    .setZone(business.timezone || "America/New_York")
                    .toFormat("MMM d, yyyy · h:mm a")}
                </p>
              </>
            ) : (
              <p>No customer acknowledgement recorded.</p>
            )}
          </article>
        </>
      )}
      {editor && (
        <ReportEditor
          business={business}
          jobId={jobId}
          onClose={() => setEditor(false)}
          onSaved={(r) => {
            setSelected(r.id);
            setRevision((v) => v + 1);
            onSaved();
          }}
        />
      )}
    </section>
  );
}
function ReportEditor({
  business,
  jobId,
  onClose,
  onSaved,
}: {
  business: CurrentBusiness;
  jobId: string;
  onClose: () => void;
  onSaved: (r: JobReport) => void;
}) {
  const [summary, setSummary] = useState(""),
    [photos, setPhotos] = useState<RecordPhoto[]>([]),
    [chosen, setChosen] = useState<string[]>([]),
    [present, setPresent] = useState(false),
    [signer, setSigner] = useState(""),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  const saving = useRef(false),
    request = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    let active = true;
    listRecordPhotos(business.id, { kind: "job", id: jobId })
      .then((p) => {
        if (active) {
          setPhotos(p);
          setReady(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [business.id, jobId]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const input = {
          summary,
          photos: chosen,
          customer_present: present,
          signer: present ? signer : "",
          consent: present && accepted ? consent : "",
        },
        key = JSON.stringify(input);
      if (request.current?.key !== key)
        request.current = { key, id: crypto.randomUUID() };
      const r = await createJobReport(
        business.id,
        jobId,
        request.current.id,
        input,
      );
      onSaved(r);
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
      label="Create completion report"
      busy={busy}
      onClose={onClose}
      wide
    >
      <form onSubmit={save}>
        <h2>Create completion report</h2>
        <p>
          The completed checklist and visit history are saved with this report.
          A correction creates a new version.
        </p>
        <label>
          Work performed
          <textarea
            required
            maxLength={4000}
            rows={5}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>Photos to include ({chosen.length} of 12)</legend>
          <p className="quiet">
            Selected photos are retained with the saved report.
          </p>
          {!ready && !error && <p role="status">Loading job photos…</p>}
          {photos.map((p) => (
            <label className="jm-report-photo-option" key={p.id}>
              <input
                type="checkbox"
                checked={chosen.includes(p.id)}
                disabled={
                  !p.url || (chosen.length >= 12 && !chosen.includes(p.id))
                }
                onChange={(e) =>
                  setChosen(
                    e.target.checked
                      ? [...chosen, p.id]
                      : chosen.filter((id) => id !== p.id),
                  )
                }
              />
              {p.url && <img src={p.url} alt="" />}
              <span>
                {p.file_name}
                {p.url ? "" : " · Upload incomplete"}
              </span>
            </label>
          ))}
          {ready && !photos.length && <p>No job photos uploaded.</p>}
        </fieldset>
        <fieldset>
          <legend>Customer acknowledgement (optional)</legend>
          <label>
            <input
              type="checkbox"
              checked={present}
              onChange={(e) => {
                setPresent(e.target.checked);
                setSigner("");
                setAccepted(false);
              }}
            />
            The customer is present and will acknowledge this report on this
            device.
          </label>
          {present && (
            <>
              <p>
                Hand this device to the customer to review the work summary and
                enter their acknowledgement.
              </p>
              <label>
                Customer’s full name
                <input
                  required
                  minLength={2}
                  maxLength={160}
                  value={signer}
                  onChange={(e) => setSigner(e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  required
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                {consent}
              </label>
              <p className="quiet">
                Saved as a typed acknowledgement captured in person, with time
                and staff account. It does not authorize payment.
              </p>
            </>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={
              busy ||
              !ready ||
              !summary.trim() ||
              (present && (!signer.trim() || !accepted))
            }
          >
            {busy ? "Saving…" : "Save report version"}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}
