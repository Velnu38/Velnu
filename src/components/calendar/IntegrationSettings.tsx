import { useEffect, useState } from "react";
import {
  calendarRequest,
  type CalendarIntegration,
  type CalendarOption,
  type CalendarProvider,
  type CalendarConnections,
} from "../../services/calendar";
function ProviderCard({
  businessId,
  provider,
  integration,
  available = true,
  onChanged,
}: {
  businessId: string;
  provider: CalendarProvider;
  integration?: CalendarIntegration;
  available?: boolean;
  onChanged: () => void;
}) {
  const name = provider === "google" ? "Google Calendar" : "Microsoft Outlook";
  const [calendars, setCalendars] = useState<CalendarOption[]>([]),
    [calendarId, setCalendarId] = useState(
      integration?.calendar_id || "primary",
    );
  const [enabled, setEnabled] = useState(integration?.auto_sync || false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const connected = integration?.state === "connected";
  useEffect(() => {
    setCalendarId(integration?.calendar_id || "primary");
    setEnabled(integration?.auto_sync || false);
    setCalendars([]);
    setError("");
    if (!connected || !integration || !available) return;
    let active = true;
    void calendarRequest<{ calendars: CalendarOption[] }>(
      "calendars",
      businessId,
      "GET",
      { integrationId: integration.id },
    )
      .then((r) => {
        if (active) setCalendars(r.calendars);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [
    businessId,
    integration?.id,
    integration?.state,
    integration?.calendar_id,
    integration?.auto_sync,
    available,
  ]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update connection.");
    } finally {
      setBusy(false);
    }
  }
  const connect = () =>
    run(async () => {
      const result = await calendarRequest<{ url: string }>(
        "connect",
        businessId,
        "POST",
        { provider },
      );
      window.location.assign(result.url);
    });
  const save = () =>
    run(async () => {
      await calendarRequest("settings", businessId, "PATCH", {
        integrationId: integration!.id,
        calendarId,
        autoSync: enabled,
      });
    });
  return (
    <article aria-label={name} className="tw:rounded-2xl tw:border tw:border-slate-200 tw:bg-white tw:p-5">
      <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
        <h3>{name}</h3>
        {connected && available && (
          <span className="tw:rounded-full tw:bg-emerald-100 tw:px-3 tw:py-1 tw:text-sm tw:font-semibold tw:text-emerald-800">
            Connected
          </span>
        )}
      </div>
      {!available && (
        <p role="status" className="form-message">
          {name} needs administrator setup before you can connect or sync this account.
        </p>
      )}
      {connected && integration ? (
        <>
          <p className="tw:break-all tw:text-sm tw:text-slate-600">
            {integration.email}
          </p>
          <label className="tw:mt-4 tw:block">
            Sync to calendar
            <select
              className="tw:mt-1 tw:w-full"
              value={calendarId}
              disabled={busy || !available}
              onChange={(e) => setCalendarId(e.target.value)}
            >
              {!calendars.some((c) => c.id === calendarId) && (
                <option value={calendarId}>{integration.calendar_name}</option>
              )}
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="tw:my-5 tw:flex tw:items-start tw:gap-3">
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              disabled={busy || !available}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Auto-populate scheduled work to my calendar</span>
          </label>
          <p className="quiet">
            Turning this off removes Finviant’s published events. Changing
            calendars moves them to the selected calendar. Personal events stay
            untouched.
          </p>
          <div className="tw:mt-4 tw:flex tw:flex-wrap tw:gap-2">
            <button
              className="primary-button compact"
              disabled={busy || !available}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save calendar settings"}
            </button>
            <button
              className="secondary-button compact"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if(!window.confirm("Disconnect this calendar and remove Finviant’s published events from it? Your personal calendar events stay unchanged."))return;
                  await calendarRequest("disconnect", businessId, "DELETE", {
                    integrationId: integration.id,
                  });
                })
              }
            >
              Disconnect & remove published events
            </button>
            <button
              className="text-button"
              disabled={busy || !available}
              onClick={() =>
                void run(async () => {
                  await calendarRequest("retry", businessId, "POST", {
                    integrationId: integration.id,
                  });
                })
              }
            >
              Retry sync
            </button>
          </div>
          {integration.last_synced_at && (
            <p className="quiet">
              Last checked:{" "}
              {new Date(integration.last_synced_at).toLocaleString()}
            </p>
          )}
        </>
      ) : integration?.state === "disconnecting" ? (
        <p role="status">Removing Finviant events and disconnecting…</p>
      ) : (
        <>
          <p className="quiet">
            Publish your scheduled work and keep reschedules and cancellations
            up to date.
          </p>
          <button
            className="primary-button"
            disabled={busy || !available}
            onClick={() => void connect()}
          >
            {integration?.state === "reconnect_required"
              ? "Reconnect"
              : `Connect ${name}`}
          </button>
        </>
      )}
      {integration?.last_error && (
        <p role="status" className="tw:mt-3 tw:text-sm tw:text-amber-800">
          {integration.last_error === "schedule_requires_end_time"
            ? "Some work needs an end time before it can sync."
            : integration.last_error === "disconnected_remote_cleanup_required"
              ? "Disconnected. Remove any remaining Finviant events from your calendar manually."
              : `Sync needs attention: ${integration.last_error.replaceAll("_", " ")}.`}
        </p>
      )}
      {integration &&
        ["reconnect_required", "disconnecting"].includes(integration.state) && (
          <div className="tw:mt-3">
            <p className="quiet">
              If access cannot be restored, you can erase the connection here.
              Remaining events must then be deleted from your calendar manually.
            </p>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if(!window.confirm("Disconnect this calendar and remove Finviant’s published events from it? Your personal calendar events stay unchanged."))return;
                  await calendarRequest("disconnect", businessId, "DELETE", {
                    integrationId: integration.id,
                    forget: true,
                  });
                })
              }
            >
              Erase connection; keep remote events
            </button>
          </div>
        )}
      {error && (
        <p role="alert" className="form-message error-text">
          {error}
        </p>
      )}
    </article>
  );
}
export default function IntegrationSettings({
  businessId,
}: {
  businessId: string;
}) {
  const [rows, setRows] = useState<CalendarIntegration[]>([]),
    [providers, setProviders] = useState<CalendarConnections["providers"]>({}),
    [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const connectionResult = new URLSearchParams(window.location.search).get('calendar');
  useEffect(() => {
    let active = true;
    setError("");
    setLoading(true);
    void calendarRequest<CalendarConnections>(
      "list",
      businessId,
    )
      .then((r) => {
        if (active) {
          setRows(r.integrations);
          setProviders(r.providers || {});
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
  }, [businessId, version]);
  useEffect(() => {
    if (!rows.some((r) => r.state === "disconnecting")) return;
    const timer = setInterval(() => setVersion((v) => v + 1), 10_000);
    return () => clearInterval(timer);
  }, [rows]);
  return (
    <section className="calendar-no-print" aria-label="Calendar integrations">
      <p className="eyebrow">Your connected calendars</p>
      <h2>Take your work schedule with you.</h2>
      <p className="quiet">
        These connections belong to your account in this business. Changes
        publish from Finviant. Events from your selected calendars appear in your
        schedule for reference; external edits do not change jobs or invoices.
      </p>
      {connectionResult === 'declined' && (
        <p role="status" className="form-message">
          Calendar access wasn’t granted. You can try connecting again below.
        </p>
      )}
      {connectionResult === 'connected' && !loading && !error && rows.some(row => row.state === 'connected') && (
        <p role="status" className="form-message success-text">
          Calendar connected. Choose your calendar and save your sync settings below.
        </p>
      )}
      {loading && <p role="status">Checking connections…</p>}
      {error ? (
        <p role="alert" className="form-message">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => setVersion((v) => v + 1)}
          >
            Retry
          </button>
        </p>
      ) : !loading ? (
        <div className="tw:mt-4 tw:grid tw:gap-4 tw:lg:grid-cols-2">
          {(["google", "outlook"] as const).map((provider) => (
            <ProviderCard
              key={`${businessId}:${provider}`}
              businessId={businessId}
              provider={provider}
              integration={rows.find((r) => r.provider === provider)}
              available={providers?.[provider]}
              onChanged={() => setVersion((v) => v + 1)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
