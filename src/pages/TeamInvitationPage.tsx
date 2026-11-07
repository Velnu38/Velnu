import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import AuthScreen from "../components/AuthScreen";
import AccountAgreement from "../components/AccountAgreement";
import { hasAcceptedAgreement } from "../lib/userAgreement";
import { acceptInvitation } from "../services/settings";
import { supabase } from "../lib/supabase";
export default function TeamInvitationPage({
  token,
  session,
}: {
  token: string;
  session: Session | null;
}) {
  const [agreement, setAgreement] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setAgreement(null);
    if (session)
      void hasAcceptedAgreement(session.user.id)
        .then((x) => {
          if (active) setAgreement(x);
        })
        .catch(() => {
          if (active)
            setError("Unable to check your agreement. Reload and try again.");
        });
    return () => {
      active = false;
    };
  }, [session?.user.id]);
  async function join() {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const id = await acceptInvitation(token);
      localStorage.setItem("finviant-active-business:" + session.user.id, id);
      sessionStorage.removeItem("finviant-team-invitation");
      window.location.assign("/");
    } catch (e) {
      setError(
        (e as Error).message ||
          "Invitation unavailable. Ask the primary owner for a new invitation.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!session)
    return (
      <AuthScreen
        initialMessage="You’ve been invited to a business. Sign in or create an account using the email address that received the invitation. No separate subscription is required."
        invitationToken={token}
      />
    );
  if (agreement === false)
    return (
      <AccountAgreement
        userId={session.user.id}
        email={session.user.email || ""}
        selectedTier="pro"
        onAccepted={() => setAgreement(true)}
        onSignOut={() => void supabase.auth.signOut()}
      />
    );
  return (
    <main className="loading-page">
      <h1>Join your business team</h1>
      <p>
        Signed in as {session.user.email}. Accept this invitation to join the
        existing workspace.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        className="primary-button"
        disabled={!agreement || busy}
        onClick={() => void join()}
      >
        {busy ? "Joining…" : "Accept invitation"}
      </button>
      <button
        className="text-button"
        onClick={() => void supabase.auth.signOut()}
      >
        Use a different account
      </button>
      <a
        href="/"
        onClick={() => sessionStorage.removeItem("finviant-team-invitation")}
      >
        Leave invitation
      </a>
    </main>
  );
}
