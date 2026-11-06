import { useEffect, useState } from "react";
import {
  subscriptionAction,
  type SubscriptionState,
} from "../../services/settings";
export default function SubscriptionSettings({
  businessId,
}: {
  businessId: string;
}) {
  const [state, setState] = useState<SubscriptionState | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  async function refresh() {
    setError("");
    try {
      setState(await subscriptionAction(businessId, "status"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, [businessId]);
  async function cancel() {
    setBusy(true);
    setError("");
    try {
      setState(await subscriptionAction(businessId, "cancel"));
      setConfirm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-panel">
      <p className="eyebrow">Owner controls</p>
      <h2>Subscription</h2><p><a className="secondary-button" href="/?view=settings&section=plans">Plans, usage &amp; tier testing</a></p>
      {error && (
        <p className="form-message error-text" role="alert">
          {error}
          <button className="text-button" onClick={() => void refresh()}>
            Retry status
          </button>
        </p>
      )}
      {!state && !error && <p role="status">Checking subscription…</p>}
      {state && (
        <>
          <p>
            {state.status === "none"
              ? "No paid subscription is active. Private testing has no subscription charges."
              : `Subscription status: ${state.status.replaceAll("_", " ")}`}
          </p>
          {state.cancel_at_period_end && (
            <p className="form-message" role="status">
              Cancellation scheduled
              {state.ends_at
                ? ` for ${new Date(state.ends_at).toLocaleDateString()}`
                : ""}
              . Access continues through the paid period.
            </p>
          )}
          <button
            className="secondary-button"
            disabled={!state.can_cancel || state.cancel_at_period_end || busy}
            onClick={() => setConfirm(true)}
          >
            Cancel subscription
          </button>
          <p className="quiet">
            Canceling stops future renewals at the end of your current billing
            period. It does not delete your business records or close your
            external payment-provider accounts.
          </p>
        </>
      )}
      {confirm && (
        <div
          className="settings-inset"
          role="alertdialog"
          aria-label="Confirm subscription cancellation"
        >
          <h3>Cancel your subscription?</h3>
          <p>
            Your subscription will not renew. You retain access through the end
            of the paid period.
          </p>
          <div className="settings-actions">
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void cancel()}
            >
              {busy ? "Confirming…" : "Confirm cancellation"}
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Keep subscription
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
