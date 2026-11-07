import { canAccess } from '../../lib/workspaceAccess'
import { localInstant } from "../../lib/calendarTime";
import { useEffect, useState, type FormEvent } from "react";
import { DateTime } from "luxon";
import type { CurrentBusiness } from "../../lib/business";
import { canManageFinances } from "../../lib/business";
import { supabase } from "../../lib/supabase";
import { announceCalendarChange } from "../../services/calendar";
export default function DocumentSchedule({
  business,
  kind,
  id,
  jobId,
}: {
  business: CurrentBusiness;
  kind: "estimate" | "invoice";
  id: string;
  jobId?: string | null;
}) {
  const zone = business.timezone || "America/New_York";
  const calendarAccess = canAccess(business, "calendar");
  const [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [state, setState] = useState("scheduled"),
    [saved, setSaved] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [ready, setReady] = useState(false);
  const field = kind === "estimate" ? "estimate_id" : "invoice_id";
  useEffect(() => {
    if (!calendarAccess) return;
    let active = true;
    setReady(false);
    setError("");
    setNotice("");
    setSaved(null);
    setStart("");
    setEnd("");
    setTitle("");
    setDescription("");
    void supabase
      .from("document_schedules")
      .select("*")
      .eq("business_id", business.id)
      .eq(field, id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError("Document scheduling is awaiting database setup.");
          return;
        }
        if (data) {
          setSaved(data.id);
          setTitle(data.job_title);
          setDescription(data.description);
          setState(data.status);
          setStart(
            DateTime.fromISO(data.scheduled_start_time)
              .setZone(zone)
              .toFormat("yyyy-MM-dd'T'HH:mm"),
          );
          setEnd(
            DateTime.fromISO(data.scheduled_end_time)
              .setZone(zone)
              .toFormat("yyyy-MM-dd'T'HH:mm"),
          );
        }
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [business.id, id, field, zone, calendarAccess]);
  if (!canManageFinances(business.role) || !calendarAccess) return null;
  if (jobId)
    return (
      <p className="quiet calendar-no-print">
        This document is linked to a job. Manage its time in Jobs &amp;
        schedule.
      </p>
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const from = localInstant(start, zone),
        to = localInstant(end, zone);
      if (to <= from) throw new Error("End time must be after the start time.");
      const payload = {
        business_id: business.id,
        [field]: id,
        job_title: title.trim(),
        description: description.trim(),
        scheduled_start_time: from,
        scheduled_end_time: to,
        timezone: zone,
        status: state,
      };
      const result = saved
        ? await supabase
            .from("document_schedules")
            .update(payload)
            .eq("id", saved)
            .eq("business_id", business.id)
            .select("id")
            .single()
        : await supabase
            .from("document_schedules")
            .upsert(payload, { onConflict: field })
            .select("id")
            .single();
      if (result.error) throw result.error;
      setSaved(result.data.id);
      announceCalendarChange();
      setNotice(
        "Schedule saved. Connected calendars update in the background.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save schedule.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="calendar-no-print tw:rounded-xl tw:border tw:border-slate-200 tw:bg-white tw:p-4">
      <summary className="tw:cursor-pointer tw:font-semibold">
        Schedule this {kind}
      </summary>
      <form
        onSubmit={(e) => void submit(e)}
        className="tw:mt-4 tw:grid tw:gap-3"
      >
        <p className="quiet">
          Times are in {zone}. Approval publishes planned work once a complete
          time range is saved.
        </p>
        <label>
          Job title
          <input
            value={title}
            maxLength={200}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Calendar description
          <textarea
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="tw:grid tw:gap-3 tw:sm:grid-cols-2">
          <label>
            Start
            <input
              type="datetime-local"
              value={start}
              required
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            End
            <input
              type="datetime-local"
              value={end}
              required
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <label>
          Schedule status
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="scheduled">
              Scheduled — publish when auto-sync is on
            </option>
            {kind === "estimate" && (
              <option value="planned">Planned — publish after approval</option>
            )}
            <option value="cancelled">Cancelled — remove calendar event</option>
          </select>
        </label>
        {error && (
          <p role="alert" className="form-message error-text">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <button className="primary-button" disabled={busy || !ready}>
          {busy ? "Saving…" : "Save schedule"}
        </button>
      </form>
    </details>
  );
}
