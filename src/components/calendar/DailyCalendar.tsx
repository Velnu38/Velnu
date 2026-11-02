import { useEffect, useState, useRef } from "react";
import { DateTime } from "luxon";
import type { CurrentBusiness } from "../../lib/business";
import { loadAgenda } from "../../services/calendar";
import { completeWorkReminder } from "../../services/reminders";
type Agenda = Awaited<ReturnType<typeof loadAgenda>>;
export default function DailyCalendar({
  business,
  onWork,
  onReminders,
}: {
  business: CurrentBusiness;
  onWork: () => void;
  onReminders: () => void;
}) {
  const zone = business.timezone || "America/New_York";
  const [today, setToday] = useState(() =>
    DateTime.now().setZone(zone).toISODate()!,
  );
  const [day, setDay] = useState(today),
    [version, setVersion] = useState(0);
  const [agenda, setAgenda] = useState<Agenda | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState<string | null>(null);
  const previousToday = useRef(today);
  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return;
      const next = DateTime.now().setZone(zone).toISODate()!;
      const previous = previousToday.current;
      previousToday.current = next;
      setToday(next);
      setDay((selected) => (selected === previous ? next : selected));
      setVersion((v) => v + 1);
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("finviant-work-changed", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("finviant-work-changed", refresh);
    };
  }, [zone]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setAgenda(null);
    void loadAgenda(business.id, day, zone)
      .then((value) => {
        if (active) setAgenda(value);
      })
      .catch(() => {
        if (active)
          setError(
            "Unable to load this day’s work. Try again or open Jobs & schedule.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [business.id, day, zone, version]);
  const selected = DateTime.fromISO(day, { zone }),
    week = selected.startOf("week");
  async function complete(id: string) {
    setBusy(id);
    try {
      await completeWorkReminder(business, id);
      setVersion((v) => v + 1);
    } catch {
      setError("Unable to complete this reminder. Try again.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <section
      className="calendar-no-print tw:rounded-2xl tw:border tw:border-slate-200 tw:bg-white tw:p-5 tw:shadow-sm"
      aria-label="Daily calendar"
    >
      <div className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-4">
        <div>
          <p className="eyebrow">Your day at a glance</p>
          <h2>
            {day === today
              ? "Today’s work"
              : selected.toLocaleString({ month: "long", day: "numeric" })}
          </h2>
          <p className="quiet">
            Scheduled work and pending reminders · {zone.replaceAll("_", " ")}
          </p>
        </div>
        <div className="tw:flex tw:flex-wrap tw:gap-2">
          <button
            className="secondary-button compact"
            onClick={() => setDay(today)}
          >
            Today
          </button>
          <button className="secondary-button compact" onClick={onWork}>
            Open schedule
          </button>
          <button className="secondary-button compact" onClick={onReminders}>
            + Reminder
          </button>
        </div>
      </div>
      <div className="tw:my-4 tw:flex tw:items-center tw:justify-between tw:gap-2">
        <button
          className="secondary-button compact"
          aria-label="Previous week"
          onClick={() => setDay(selected.minus({ weeks: 1 }).toISODate()!)}
        >
          ←
        </button>
        <label className="tw:flex tw:items-center tw:gap-2">
          Date
          <input
            type="date"
            aria-label="Calendar date"
            value={day}
            onChange={(e) => {
              if (e.target.value) setDay(e.target.value);
            }}
          />
        </label>
        <button
          className="secondary-button compact"
          aria-label="Next week"
          onClick={() => setDay(selected.plus({ weeks: 1 }).toISODate()!)}
        >
          →
        </button>
      </div>
      <div className="tw:grid tw:grid-cols-7 tw:gap-1" aria-label="Choose day">
        {Array.from({ length: 7 }, (_, index) => {
          const date = week.plus({ days: index }),
            key = date.toISODate()!;
          return (
            <button
              key={key}
              type="button"
              aria-label={date.toLocaleString(DateTime.DATE_FULL)}
              aria-pressed={day === key}
              onClick={() => setDay(key)}
              className={`tw:rounded-xl tw:border tw:px-1 tw:py-3 tw:text-center ${day === key ? "tw:border-blue-700 tw:bg-blue-700 tw:text-white" : "tw:border-slate-200 tw:bg-slate-50 tw:text-slate-800"}`}
            >
              <span className="tw:block tw:text-xs">
                {date.toFormat("ccc")}
              </span>
              <strong className="tw:text-lg">{date.day}</strong>
              {key === today && (
                <span className="tw:block tw:text-xs">Today</span>
              )}
            </button>
          );
        })}
      </div>
      {loading && (
        <p role="status" className="tw:py-4">
          Loading daily work…
        </p>
      )}
      {error && (
        <p role="alert" className="form-message error-text">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => setVersion((v) => v + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {agenda && (
        <div className="tw:mt-5 tw:grid tw:gap-6 tw:lg:grid-cols-2">
          <div>
            <h3>
              Scheduled work{" "}
              <span className="quiet">({agenda.work.length})</span>
            </h3>
            {agenda.work.length === 0 ? (
              <p className="quiet">No work scheduled for this day.</p>
            ) : (
              <ul className="tw:m-0 tw:list-none tw:p-0">
                {agenda.work.map((work) => (
                  <li
                    key={work.source_key}
                    className="tw:border-b tw:border-slate-100 tw:py-3"
                  >
                    <a
                      className="tw:font-semibold tw:text-blue-800"
                      href={`/?view=${work.document_kind === "invoice" ? "invoices" : work.document_kind === "estimate" ? "estimates" : "work"}&document=${encodeURIComponent(work.document_id)}`}
                    >
                      {work.title}
                    </a>
                    <p className="quiet">
                      {DateTime.fromISO(work.starts_at)
                        .setZone(zone)
                        .toLocaleString(DateTime.TIME_SIMPLE)}
                      {work.ends_at
                        ? ` – ${DateTime.fromISO(work.ends_at).setZone(zone).toLocaleString(DateTime.TIME_SIMPLE)}`
                        : " · Add an end time to sync"}{" "}
                      · {work.status.replaceAll("_", " ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3>
              To do <span className="quiet">({agenda.reminders.length})</span>
            </h3>
            {agenda.reminders.length === 0 ? (
              <p className="quiet">No pending reminders due by this day.</p>
            ) : (
              <ul className="tw:m-0 tw:list-none tw:p-0">
                {agenda.reminders.map((reminder) => {
                  const due = DateTime.fromISO(reminder.due_at).setZone(zone),
                    overdue = due < DateTime.now().setZone(zone);
                  return (
                    <li
                      key={reminder.id}
                      className="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:border-b tw:border-slate-100 tw:py-3"
                    >
                      <div>
                        <strong>{reminder.note || "Follow up"}</strong>
                        <p
                          className={
                            overdue ? "tw:text-sm tw:text-amber-800" : "quiet"
                          }
                        >
                          {overdue ? "Overdue · " : ""}
                          {due.toLocaleString(DateTime.DATETIME_SHORT)}
                        </p>
                      </div>
                      {business.role !== "viewer" && (
                        <button
                          className="secondary-button compact"
                          disabled={busy !== null}
                          onClick={() => void complete(reminder.id)}
                          aria-label={`Complete ${reminder.note || "reminder"}`}
                        >
                          {busy === reminder.id ? "Saving…" : "Done"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
      {agenda?.limited && (
        <p className="quiet">
          Showing the first 200 items in each list. Open the full schedule and
          reminders to review more.
        </p>
      )}
    </section>
  );
}
