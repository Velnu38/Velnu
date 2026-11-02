import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { database, transaction, appOrigin } from "./db.js";
import { provider } from "./providers.js";
import { eventInput, fingerprint } from "./reconcile.js";
import { classify, log, retrySeconds } from "./errors.js";
import type { Integration, Work } from "./types.js";
type Task = {
  integration_id: string;
  revision: string;
  attempts: number;
  lease_id: string;
};
type Link = {
  source_key: string;
  calendar_id: string;
  calendar_event_id: string | null;
  generation: number;
  fingerprint: string | null;
};
type Runtime = {
  database: typeof database;
  transaction: typeof transaction;
  provider: typeof provider;
  appOrigin: typeof appOrigin;
};
const defaultRuntime: Runtime = { database, transaction, provider, appOrigin };
async function claim(runtime: Runtime): Promise<Task | undefined> {
  const id = randomUUID();
  const r = await runtime.database().query(
    `with candidate as (select integration_id from private.calendar_sync_queue where not dead and available_at<=now() and (lease_until is null or lease_until<now()) order by available_at for update skip locked limit 1)
    update private.calendar_sync_queue q set lease_id=$1,lease_until=now()+interval '5 minutes' from candidate c where q.integration_id=c.integration_id returning q.*`,
    [id],
  );
  return r.rows[0];
}
async function finish(
  db: PoolClient,
  task: Task,
  more: boolean,
  reason: string | null = null,
  delay = 0,
  dead = false,
) {
  // A source change during processing wins over completion and schedules another pass.
  if (!more && !reason)
    await db.query(
      "delete from private.calendar_sync_queue where integration_id=$1 and lease_id=$2 and revision=$3",
      [task.integration_id, task.lease_id, task.revision],
    );
  await db.query(
    `update private.calendar_sync_queue set lease_id=null,lease_until=null,
    attempts=case when revision=$3 then attempts+1 else 0 end,
    dead=case when revision=$3 then $6 else false end,last_error=$4,
    available_at=case when revision=$3 then now()+($5*interval '1 second') else now() end
    where integration_id=$1 and lease_id=$2`,
    [task.integration_id, task.lease_id, task.revision, reason, delay, dead],
  );
}
export async function runSyncBatch(runtime: Runtime = defaultRuntime) {
  const task = await claim(runtime);
  if (!task) return { processed: 0 };
  const started = Date.now();
  log("sync_initiated", {
    integration_id: task.integration_id,
    attempt: task.attempts + 1,
  });
  try {
    await runtime.transaction(async (db) => {
      const integration = (
        await db.query(
          "select * from private.calendar_integrations where id=$1 for update",
          [task.integration_id],
        )
      ).rows[0] as Integration | undefined;
      if (!integration) {
        return;
      }
      try {
        if (integration.state === "disconnected") {
          await finish(db, task, false);
          return;
        }
        if (integration.state === "reconnect_required") {
          await finish(db, task, true, "authorization_revoked", 0, true);
          return;
        }
        const membership = (
          await db.query(
            "select role from public.business_members where business_id=$1 and user_id=$2",
            [integration.business_id, integration.user_id],
          )
        ).rows[0];
        const svc = runtime.provider(db, integration);
        const active =
          membership &&
          integration.auto_sync &&
          integration.state === "connected";
        const work = active
          ? ((
              await db.query(
                `select * from public.calendar_work where business_id=$1 and (assigned_user_id is null or assigned_user_id=$2)
        and ($3::boolean or document_kind='work' or source_key like 'job:%' or source_key like 'appointment:%') order by source_key`,
                [
                  integration.business_id,
                  integration.user_id,
                  ["owner", "admin", "office"].includes(membership.role),
                ],
              )
            ).rows as Work[])
          : [];
        // Field staff may see work but must not receive financial document deep links.
        if (
          membership &&
          !["owner", "admin", "office"].includes(membership.role)
        )
          for (const w of work) {
            w.document_kind = "work";
            w.document_id = w.source_key.split(":")[1];
          }
        const links = (
          await db.query(
            "select * from private.calendar_event_links where integration_id=$1",
            [integration.id],
          )
        ).rows as Link[];
        const byKey = new Map(work.map((w) => [w.source_key, w]));
        let operations = 0,
          more = false,
          missingEnd = false;
        const budget = () => operations < 8 && Date.now() - started < 35_000;
        // Remove only mappings created by Finviant. Calendar changes clean up the old target first.
        for (const l of links) {
          if (
            l.calendar_event_id &&
            (!byKey.get(l.source_key)?.ends_at ||
              l.calendar_id !== integration.calendar_id)
          ) {
            if (!budget()) {
              more = true;
              break;
            }
            await svc.remove(l.calendar_id, l.calendar_event_id);
            operations++;
            await db.query(
              "update private.calendar_event_links set calendar_event_id=null,fingerprint=null,generation=generation+1 where integration_id=$1 and source_key=$2 and calendar_id=$3",
              [integration.id, l.source_key, l.calendar_id],
            );
            l.calendar_event_id = null;
            l.fingerprint = null;
            l.generation++;
          }
        }
        if (!more)
          for (const w of work) {
            if (!w.ends_at) {
              missingEnd = true;
              continue;
            }
            let l = links.find(
              (x) =>
                x.source_key === w.source_key &&
                x.calendar_id === integration.calendar_id,
            );
            if (!l) {
              l = {
                source_key: w.source_key,
                calendar_id: integration.calendar_id,
                calendar_event_id: null,
                generation: 0,
                fingerprint: null,
              };
              await db.query(
                "insert into private.calendar_event_links(integration_id,source_key,calendar_id) values($1,$2,$3) on conflict do nothing",
                [integration.id, w.source_key, integration.calendar_id],
              );
            }
            const input = eventInput(
                w,
                `${integration.id}:${w.source_key}:${integration.calendar_id}:${l.generation}`,
                runtime.appOrigin(),
              ),
              hash = fingerprint(input);
            if (l.fingerprint === hash && l.calendar_event_id) continue;
            if (!budget()) {
              more = true;
              break;
            }
            try {
              const id = await svc.upsert(
                integration.calendar_id,
                l.calendar_event_id,
                input,
              );
              operations++;
              await db.query(
                "update private.calendar_event_links set calendar_event_id=$4,fingerprint=$5,updated_at=now() where integration_id=$1 and source_key=$2 and calendar_id=$3",
                [
                  integration.id,
                  w.source_key,
                  integration.calendar_id,
                  id,
                  hash,
                ],
              );
            } catch (e) {
              if (
                [404, 410].includes(classify(e).status) &&
                l.calendar_event_id
              ) {
                await db.query(
                  "update private.calendar_event_links set calendar_event_id=null,fingerprint=null,generation=generation+1 where integration_id=$1 and source_key=$2 and calendar_id=$3",
                  [integration.id, w.source_key, integration.calendar_id],
                );
                more = true;
                break;
              }
              throw e;
            }
          }
        if (!more && integration.state === "disconnecting")
          await db.query(
            "update private.calendar_integrations set state='disconnected',credentials=null,auto_sync=false,last_error=null where id=$1",
            [integration.id],
          );
        else
          await db.query(
            "update private.calendar_integrations set last_synced_at=now(),last_error=$2 where id=$1",
            [integration.id, missingEnd ? "schedule_requires_end_time" : null],
          );
        await finish(db, task, more);
        log("sync_success", {
          integration_id: integration.id,
          operations,
          more,
          reason: missingEnd ? "schedule_requires_end_time" : "reconciled",
          duration_ms: Date.now() - started,
        });
      } catch (error) {
        const issue = classify(error),
          dead = !issue.retryable || task.attempts >= 11;
        if (issue.reason === "authorization_revoked")
          await db.query(
            "update private.calendar_integrations set state=case when state='disconnecting' then 'disconnected' else 'reconnect_required' end,credentials=case when state='disconnecting' then null else credentials end,last_error=$2 where id=$1",
            [
              integration.id,
              integration.state === "disconnecting"
                ? "disconnected_remote_cleanup_required"
                : issue.reason,
            ],
          );
        else
          await db.query(
            "update private.calendar_integrations set last_error=$2 where id=$1",
            [integration.id, issue.reason],
          );
        await finish(
          db,
          task,
          true,
          issue.reason,
          retrySeconds(task.attempts + 1, issue.retryAfter),
          dead,
        );
        log("sync_failed", {
          integration_id: integration.id,
          reason: issue.reason,
          retryable: issue.retryable,
          dead,
          duration_ms: Date.now() - started,
        });
      }
    });
    return { processed: 1 };
  } catch (error) {
    // A DB failure rolls the transaction back; the lease expires for crash recovery.
    log("sync_failed", {
      integration_id: task.integration_id,
      reason: "database_transaction_failed",
      retryable: true,
    });
    throw error;
  }
}
