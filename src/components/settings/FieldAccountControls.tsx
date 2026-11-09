import { useEffect, useState } from "react";
import type { CurrentBusiness } from "../../lib/business";
import { getWorkers, type WorkerProfile } from "../../services/workers";
import {
  getFieldAccounts,
  clearFieldAccount,
  setFieldAccount,
  type FieldAccount,
} from "../../services/jobExecution";
import type { TeamMember } from "../../services/settings";
export default function FieldAccountControls({
  business,
  members,
}: {
  business: CurrentBusiness;
  members: TeamMember[];
}) {
  const [accounts, setAccounts] = useState<FieldAccount[]>([]),
    [workers, setWorkers] = useState<WorkerProfile[]>([]),
    [choice, setChoice] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    setReady(false);
    Promise.all([getFieldAccounts(business.id), getWorkers(business.id)])
      .then(([a, w]) => {
        if (active) {
          setAccounts(a);
          setWorkers(w.workers);
          setChoice(
            Object.fromEntries(
              a.map((x) => [x.user_id, x.enabled === false ? "" : x.worker_id]),
            ),
          );
          setReady(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [business.id, revision]);
  async function save(user: string) {
    const account = accounts.find((a) => a.user_id === user),
      worker = choice[user] || null;
    if (!worker && !account) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await setFieldAccount(business.id, user, worker, account?.version || 0);
      setRevision((v) => v + 1);
      setNotice(
        worker
          ? "Assigned-job access saved. This person now sees the field workspace only."
          : "Field access paused. This account stays restricted and cannot open jobs until you assign a worker again.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const field = members.filter(
    (m) => m.role === "technician" && !m.primary_owner,
  );
  return (
    <section className="settings-inset" aria-label="Assigned-job access">
      <h3>Assigned-job access</h3>
      <p>
        Link a field staff account to its worker profile. They can view assigned
        jobs, update checklists and visits, submit time for review, and add job
        photos. Financial records and other customers stay restricted. Each
        linked account uses one of the existing five Pro seats.
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!field.length && (
        <p className="quiet">
          Invite a field staff member first. Then link their accepted account to
          an active worker here.
        </p>
      )}
      {field.map((m) => {
        const a = accounts.find((a) => a.user_id === m.user_id);
        return (
          <div className="team-member" key={m.user_id}>
            <label>
              {m.email}
              <select
                aria-label={"Worker profile for " + m.email}
                disabled={busy || !ready}
                value={choice[m.user_id] || ""}
                onChange={(e) =>
                  setChoice({ ...choice, [m.user_id]: e.target.value })
                }
              >
                <option value="">Pause field access</option>
                {workers
                  .filter(
                    (w) => !w.is_owner && (w.active || w.id === a?.worker_id),
                  )
                  .map((w) => (
                    <option
                      key={w.id}
                      value={w.id}
                      disabled={
                        !w.active ||
                        accounts.some(
                          (x) =>
                            x.user_id !== m.user_id && x.worker_id === w.id,
                        )
                      }
                    >
                      {w.name}
                      {w.active ? "" : " (inactive)"}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button compact"
              disabled={
                busy ||
                !ready ||
                (!a && !choice[m.user_id]) ||
                (a?.enabled !== false
                  ? a?.worker_id === choice[m.user_id]
                  : !choice[m.user_id])
              }
              onClick={() => void save(m.user_id)}
            >
              Save field access
            </button>
            {a && (
              <button
                type="button"
                className="text-button"
                disabled={busy || !ready}
                onClick={async () => {
                  if (
                    !confirm(
                      "Switch this account to general staff access? Customers and locations follow the staff role. Module permissions will remain disabled until you edit access.",
                    )
                  )
                    return;
                  setBusy(true);
                  setError("");
                  try {
                    await clearFieldAccount(business.id, m.user_id, a.version);
                    setRevision((v) => v + 1);
                    setNotice(
                      "Field restriction removed. Use Edit access to set general staff permissions.",
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Use general staff access
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
