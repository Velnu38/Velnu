import { useEffect, useRef, useState, type FormEvent } from "react";
import { DateTime } from "luxon";
import type { CurrentBusiness } from "../lib/business";
import { supabase } from "../lib/supabase";
import {
  getFieldJobs,
  manageFieldJob,
  uploadFieldPhoto,
  type FieldJob,
} from "../services/jobExecution";
import {
  listRecordPhotos,
  removeRecordPhoto,
  type RecordPhoto,
} from "../services/recordResources";
import { confirmNavigation, useUnsavedChanges } from "../lib/unsavedChanges";
import FinBrand from "../components/FinBrand";
import "../components/job-management.css";
export default function FieldJobsPage({
  business,
}: {
  business: CurrentBusiness;
}) {
  const [page, setPage] = useState(0);
  const [jobs, setJobs] = useState<FieldJob[]>([]),
    [selected, setSelected] = useState<FieldJob | null>(null),
    [id, setId] = useState(""),
    [photos, setPhotos] = useState<RecordPhoto[]>([]),
    [tab, setTab] = useState("visits"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true);
  const [time, setTime] = useState({
      worked_on: DateTime.now()
        .setZone(business.timezone || "America/New_York")
        .toISODate()!,
      minutes: "60",
      note: "",
      visit_id: "",
    }),
    [timeDirty, setTimeDirty] = useState(false);
  const guard = useUnsavedChanges(busy),
    request = useRef<{ key: string; id: string } | null>(null),
    saving = useRef(false),
    zone = business.timezone || "America/New_York";
  useEffect(() => {
    if (timeDirty) guard.markDirty();
    else guard.markClean();
  }, [timeDirty]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSelected(null);
    setPhotos([]);
    Promise.all([
      getFieldJobs(business.id, undefined, page * 100),
      id ? getFieldJobs(business.id, id) : Promise.resolve([]),
      id
        ? listRecordPhotos(business.id, { kind: "job", id })
        : Promise.resolve([]),
    ])
      .then(([list, detail, pictures]) => {
        if (active) {
          setJobs(list);
          setSelected(detail[0] || null);
          setPhotos(pictures);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {
          setJobs([]);
          setSelected(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [business.id, id, revision, business.field_active, page]);
  async function action(work: () => Promise<unknown>, message: string) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(message);
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function choose(next: string) {
    if (!confirmNavigation()) return;
    setTimeDirty(false);
    guard.markClean();
    setId(next);
    setTime((t) => ({ ...t, note: "", visit_id: "" }));
    setNotice("");
    request.current = null;
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const key = JSON.stringify(time);
    if (request.current?.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    const rid = request.current.id;
    await action(async () => {
      await manageFieldJob(business.id, selected.id, "time", {
        ...time,
        minutes: Number(time.minutes),
        id: rid,
      });
      setTimeDirty(false);
      guard.markClean();
      setTime((t) => ({ ...t, note: "" }));
      request.current = null;
    }, "Time submitted to the office for review. It has not been invoiced.");
  }
  const closed =
    selected && ["completed", "canceled"].includes(selected.status);
  return (
    <main className="field-workspace">
      <header className="jm-section-heading">
        <FinBrand wordmark />
        <div className="jm-inline-actions">
          <button
            type="button"
            className="secondary-button compact"
            disabled={busy}
            onClick={() => setRevision((v) => v + 1)}
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (confirmNavigation()) void supabase.auth.signOut();
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <h1>My jobs</h1>
      <p className="quiet">{business.name} · Assigned work</p>
      {error && (
        <p role="alert" className="jm-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="jm-notice">
          {notice}
        </p>
      )}
      {loading && <p role="status">Loading assigned work…</p>}
      {!id ? (
        <>
          <p>Select a job to review its visits and report your work.</p>
          <ul className="jm-lines">
            {jobs.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  className="field-job-link"
                  onClick={() => choose(j.id)}
                >
                  <strong>{j.title}</strong>
                  <span>
                    {j.customer} · {j.status.replaceAll("_", " ")}
                  </span>
                  <small>{j.address || "Address not provided"}</small>
                </button>
              </li>
            ))}
          </ul>
          {!loading && !jobs.length && !error && (
            <p>No assigned jobs on this page.</p>
          )}
          <div className="pagination-row">
            <button
              type="button"
              className="secondary-button compact"
              disabled={loading || page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </button>
            <span>Page {page + 1}</span>
            <button
              type="button"
              className="secondary-button compact"
              disabled={loading || jobs.length < 100}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => choose("")}
          >
            ← All my jobs
          </button>
          {selected && (
            <>
              <header>
                <h2>{selected.title}</h2>
                <p>{selected.customer}</p>
                <p>{selected.address || "No service address recorded"}</p>
                {selected.phone && (
                  <a href={"tel:" + selected.phone.replace(/[^+0-9]/g, "")}>
                    Call customer
                  </a>
                )}
                <p>{selected.description}</p>
              </header>
              <nav className="jm-field-tabs" aria-label="Assigned job sections">
                {["visits", "tasks", "time", "photos"].map((t) => (
                  <button
                    type="button"
                    key={t}
                    aria-current={tab === t ? "page" : undefined}
                    onClick={() => setTab(t)}
                  >
                    {t === "time" ? "My time" : t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </nav>
              {tab === "visits" && (
                <section>
                  <h3>My visits</h3>
                  <p className="quiet">
                    Times in {zone.replaceAll("_", " ")}. Finishing a visit
                    keeps the job open for the office.
                  </p>
                  <ul className="jm-lines">
                    {selected.visits.map((v) => (
                      <li key={v.id}>
                        <div>
                          <strong>{v.title}</strong>
                          <small>
                            {DateTime.fromISO(v.starts_at)
                              .setZone(zone)
                              .toFormat("EEE, MMM d · h:mm a")}{" "}
                            · {v.status.replaceAll("_", " ")}
                          </small>
                        </div>
                        {!closed &&
                          Date.parse(v.starts_at) <= Date.now() &&
                          ["scheduled", "confirmed", "in_progress"].includes(
                            v.status,
                          ) && (
                            <div className="jm-inline-actions">
                              {v.status !== "in_progress" && (
                                <button
                                  type="button"
                                  className="secondary-button compact"
                                  disabled={busy}
                                  onClick={() =>
                                    void action(
                                      () =>
                                        manageFieldJob(
                                          business.id,
                                          selected.id,
                                          "start_visit",
                                          { id: v.id, version: v.version },
                                        ),
                                      "Visit started.",
                                    )
                                  }
                                >
                                  Start visit
                                </button>
                              )}
                              <button
                                type="button"
                                className="primary-button compact"
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    confirm(
                                      "Finish this visit? The job remains open for office review.",
                                    )
                                  )
                                    void action(
                                      () =>
                                        manageFieldJob(
                                          business.id,
                                          selected.id,
                                          "finish_visit",
                                          { id: v.id, version: v.version },
                                        ),
                                      "Visit finished.",
                                    );
                                }}
                              >
                                Finish visit
                              </button>
                            </div>
                          )}
                      </li>
                    ))}
                  </ul>
                  {!selected.visits.length && (
                    <p>No visits assigned to you yet.</p>
                  )}
                </section>
              )}
              {tab === "tasks" && (
                <section>
                  <h3>Work checklist</h3>
                  <ul className="job-checklist">
                    {selected.tasks.map((t) => (
                      <li key={t.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={t.completed}
                            disabled={busy || !!closed || !t.can_update}
                            onChange={(e) =>
                              void action(
                                () =>
                                  manageFieldJob(
                                    business.id,
                                    selected.id,
                                    "task",
                                    {
                                      id: t.id,
                                      version: t.version,
                                      completed: e.target.checked,
                                    },
                                  ),
                                "Checklist updated.",
                              )
                            }
                          />
                          <span>
                            {t.title}
                            <small>
                              {t.visit_id
                                ? selected.visits.find(
                                    (v) => v.id === t.visit_id,
                                  )?.title || "Another crew visit"
                                : "Whole job"}
                              {!t.can_update
                                ? " · Assigned to another worker"
                                : ""}
                            </small>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {!selected.tasks.length && <p>No tasks recorded.</p>}
                </section>
              )}
              {tab === "time" && (
                <section>
                  <h3>My time</h3>
                  {!closed && (
                    <form
                      className="jm-field-time"
                      onSubmit={submit}
                      onChangeCapture={() => setTimeDirty(true)}
                    >
                      <fieldset disabled={busy}>
                        <legend>Submit completed work</legend>
                        <div className="form-grid">
                          <label>
                            Work date
                            <input
                              type="date"
                              required
                              max={DateTime.now().setZone(zone).toISODate()!}
                              value={time.worked_on}
                              onChange={(e) =>
                                setTime({ ...time, worked_on: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            Minutes worked
                            <input
                              type="number"
                              required
                              min="1"
                              max="1440"
                              step="1"
                              value={time.minutes}
                              onChange={(e) =>
                                setTime({ ...time, minutes: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            Visit (optional)
                            <select
                              value={time.visit_id}
                              onChange={(e) =>
                                setTime({ ...time, visit_id: e.target.value })
                              }
                            >
                              <option value="">Whole job</option>
                              {selected.visits.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.title} ·{" "}
                                  {DateTime.fromISO(v.starts_at)
                                    .setZone(zone)
                                    .toFormat("MMM d")}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Work performed
                            <textarea
                              maxLength={400}
                              value={time.note}
                              onChange={(e) =>
                                setTime({ ...time, note: e.target.value })
                              }
                            />
                          </label>
                        </div>
                        <button className="primary-button" disabled={busy}>
                          Submit time for review
                        </button>
                      </fieldset>
                    </form>
                  )}
                  <ul className="jm-lines">
                    {selected.time.map((t) => (
                      <li key={t.id}>
                        <div>
                          <strong>
                            {t.worked_on} · {t.minutes} minutes
                          </strong>
                          <small>
                            {t.status === "posted"
                              ? "Reviewed & posted"
                              : t.status === "rejected"
                                ? "Returned by office"
                                : "Awaiting office review"}{" "}
                            · {t.note}
                          </small>
                          {t.review_note && (
                            <small>Office note: {t.review_note}</small>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {tab === "photos" && (
                <section>
                  <h3>Job photos</h3>
                  {!closed && (
                    <label className="secondary-button field-photo-picker">
                      Take or upload a photo
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file)
                            void action(
                              () =>
                                uploadFieldPhoto(
                                  business.id,
                                  selected.id,
                                  file,
                                ),
                              "Job photo uploaded.",
                            );
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  <ul className="field-photo-grid">
                    {photos.map((p) => (
                      <li key={p.id}>
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noreferrer">
                            <img src={p.url} alt={p.file_name} />
                          </a>
                        ) : (
                          <p>Upload incomplete: {p.file_name}</p>
                        )}
                        <small>{p.file_name}</small>
                        {p.created_by === business.field_user_id && (
                          <button
                            type="button"
                            className="text-button"
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  "Remove this photo? Published report photos are retained.",
                                )
                              )
                                void action(
                                  () => removeRecordPhoto(business.id, p),
                                  "Photo removed.",
                                );
                            }}
                          >
                            Remove my photo
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
