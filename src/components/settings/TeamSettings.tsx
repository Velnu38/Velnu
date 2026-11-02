import { useEffect, useState, type FormEvent } from "react";
import type { CurrentBusiness } from "../../lib/business";
import {
  workspaceModules,
  type WorkspaceModule,
} from "../../lib/workspaceAccess";
import {
  getTeam,
  inviteMember,
  manageMember,
  type TeamState,
  type TeamRole,
  type TeamMember,
} from "../../services/settings";
const defaults: WorkspaceModule[] = ["calendar", "jobs"];
const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : (e as { message?: string })?.message || "Unable to update the team.";
function AccessFields({
  role,
  modules,
  onChange,
  disabled = false,
}: {
  role: string;
  modules: WorkspaceModule[];
  onChange: (m: WorkspaceModule[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="settings-access">
      <legend>Dashboard visibility and access</legend>
      {workspaceModules.map((m) => (
        <label key={m.id}>
          <input
            type="checkbox"
            checked={modules.includes(m.id)}
            disabled={
              disabled ||
              (["technician", "viewer"].includes(role) &&
                ["billing", "finances"].includes(m.id))
            }
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...modules, m.id]
                  : modules.filter((x) => x !== m.id),
              )
            }
          />
          <span>{m.label}</span>
        </label>
      ))}
      <small>
        Customers and locations remain available for day-to-day work. A disabled
        area is also blocked through direct links and data requests.
      </small>
    </fieldset>
  );
}
export default function TeamSettings({
  business,
}: {
  business: CurrentBusiness;
}) {
  const [team, setTeam] = useState<TeamState | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(""),
    [role, setRole] = useState<TeamRole>("technician"),
    [modules, setModules] = useState<WorkspaceModule[]>(defaults),
    [inviteUrl, setInviteUrl] = useState(""),
    [editing, setEditing] = useState<TeamMember | null>(null);
  async function refresh() {
    setTeam(await getTeam(business.id));
  }
  useEffect(() => {
    let active = true;
    void getTeam(business.id)
      .then((t) => {
        if (active) setTeam(t);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [business.id]);
  function changeRole(r: TeamRole) {
    setRole(r);
    if (r !== "office")
      setModules((m) => m.filter((x) => !["billing", "finances"].includes(x)));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    setInviteUrl("");
    try {
      const r = await inviteMember(business.id, email, role, modules);
      setInviteUrl(r.url);
      setNotice(
        r.email_status === "accepted"
          ? "Invitation email accepted for delivery. The link expires in seven days."
          : "Invitation created. Email delivery is not confirmed; copy the invitation link to share it.",
      );
      setEmail("");
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function manage(
    target: string,
    action: "remove" | "revoke" | "update",
    r?: TeamRole,
    m?: WorkspaceModule[],
  ) {
    if (
      action === "remove" &&
      !window.confirm(
        "Remove this person’s access? Their saved work and activity history will be kept.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await manageMember(business.id, target, action, r, m);
      setEditing(null);
      await refresh();
      setNotice(
        action === "remove"
          ? "Member removed. Their business access has ended."
          : "Team updated.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const used = (team?.members.length || 0) + (team?.invitations.length || 0);
  return (
    <section className="settings-panel">
      <div className="split-heading">
        <div>
          <p className="eyebrow">Owner controls</p>
          <h2>Team & access</h2>
        </div>
        <span className="status-chip">
          {team ? `${used} of ${team.seat_limit} seats` : "Loading…"}
        </span>
      </div>
      <p className="quiet">
        Pro includes five users total: you and four team members. Only you can
        invite people, remove access, or change permissions. Pending invitations
        reserve a seat.
      </p>
      {team?.private_preview && (
        <p className="form-message">
          Private team testing: five seats are available with no subscription
          charge. Paid AI and other paid services are not activated.
        </p>
      )}
      {error && (
        <p role="alert" className="form-message error-text">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="form-message">
          {notice}
        </p>
      )}
      {inviteUrl && (
        <div className="invitation-link">
          <label>
            Private invitation link
            <input
              value={inviteUrl}
              readOnly
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            className="secondary-button"
            onClick={() =>
              void navigator.clipboard
                .writeText(inviteUrl)
                .then(() => setNotice("Invitation link copied."))
                .catch(() =>
                  setNotice("Select and copy the invitation link above."),
                )
            }
          >
            Copy link
          </button>
        </div>
      )}
      {team?.members.map((m) => (
        <article className="team-member" key={m.user_id}>
          <div>
            <strong>{m.email}</strong>
            <span>
              {m.primary_owner
                ? "Primary owner"
                : m.role === "office"
                  ? "Office staff"
                  : m.role === "technician"
                    ? "Field staff"
                    : m.role}
            </span>
          </div>
          {!m.primary_owner && (
            <div className="settings-actions">
              <button
                className="secondary-button compact"
                disabled={busy}
                onClick={() =>
                  setEditing({
                    ...m,
                    role: m.role === "admin" ? "office" : m.role,
                  })
                }
              >
                Edit access
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void manage(m.user_id, "remove")}
              >
                Remove
              </button>
            </div>
          )}
        </article>
      ))}
      {editing && (
        <section className="settings-inset" aria-label="Edit member access">
          <h3>{editing.email}</h3>
          <label>
            Role
            <select
              value={editing.role}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  role: e.target.value,
                  access_modules:
                    e.target.value === "office"
                      ? editing.access_modules
                      : editing.access_modules.filter(
                          (x) => !["billing", "finances"].includes(x),
                        ),
                })
              }
            >
              <option value="office">Office staff</option>
              <option value="technician">Field staff</option>
              <option value="viewer">Read-only staff</option>
            </select>
          </label>
          <AccessFields
            role={editing.role}
            modules={editing.access_modules}
            onChange={(m) => setEditing({ ...editing, access_modules: m })}
            disabled={busy}
          />
          <div className="settings-actions">
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void manage(
                  editing.user_id,
                  "update",
                  editing.role as TeamRole,
                  editing.access_modules,
                )
              }
            >
              Save access
            </button>
            <button
              className="secondary-button"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      {!!team?.invitations.length && (
        <div className="settings-inset">
          <h3>Pending invitations</h3>
          {team.invitations.map((i) => (
            <article className="team-member" key={i.id}>
              <div>
                <strong>{i.email}</strong>
                <span>
                  Expires {new Date(i.expires_at).toLocaleDateString()}
                </span>
              </div>
              <div className="settings-actions">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const r = await inviteMember(
                        business.id,
                        i.email,
                        i.role,
                        i.access_modules,
                        i.id,
                      );
                      setInviteUrl(r.url);
                      setNotice(
                        r.email_status === "accepted"
                          ? "New invitation email accepted. The previous link is no longer valid."
                          : "New link created. Email delivery is unconfirmed; copy the link to share it.",
                      );
                      await refresh();
                    } catch (e) {
                      setError(errorText(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Resend
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void manage(i.id, "revoke")}
                >
                  Cancel invitation
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {team && !(team.team_enabled ?? team.pro) ? (
        <p className="form-message">
          Team invitations require an activated Pro plan. Selecting Pro during
          private testing does not activate a paid subscription.
        </p>
      ) : team && used >= team.seat_limit ? (
        <p className="form-message">
          All five seats are in use or reserved. Remove a member or cancel a
          pending invitation to free a seat.
        </p>
      ) : (
        team && (
          <form className="settings-inset" onSubmit={submit}>
            <h3>Invite a team member</h3>
            <div className="profile-field-grid">
              <label>
                Email address
                <input
                  type="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label>
                Role
                <select
                  value={role}
                  onChange={(e) => changeRole(e.target.value as TeamRole)}
                  disabled={busy}
                >
                  <option value="technician">Field staff</option>
                  <option value="office">Office staff</option>
                  <option value="viewer">Read-only staff</option>
                </select>
              </label>
            </div>
            <AccessFields
              role={role}
              modules={modules}
              onChange={setModules}
              disabled={busy}
            />
            <button className="primary-button" disabled={busy}>
              {busy ? "Saving…" : "Send invitation"}
            </button>
          </form>
        )
      )}
    </section>
  );
}
