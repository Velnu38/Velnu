-- Applied to Owedly-Test only after both email endpoints use the service-only outbox.
-- Preserve SELECT and existing tenant RLS. Browsers may not forge delivery receipts.
revoke insert,update,delete on public.messages from anon,authenticated;
comment on table public.messages is 'Workspace-visible communication activity; delivery state is written only by the authorized backend and verified provider receipts. Existing tenant RLS remains in effect.';
