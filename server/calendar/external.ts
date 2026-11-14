import { DateTime } from 'luxon'
import type { PoolClient } from 'pg'
import { transaction } from './db.js'
import { provider } from './providers.js'
import { CalendarError, classify } from './errors.js'
import type { Integration, CalendarService } from './types.js'
import type { ConnectedAgenda } from '../../src/lib/calendarTypes.js'

export function externalRange(start: unknown, end: unknown, timezone: unknown) {
  if (typeof start !== 'string' || typeof end !== 'string' || typeof timezone !== 'string') throw new CalendarError('invalid_calendar_range', false, 0, 400)
  const from = DateTime.fromISO(start, { zone: timezone }), to = DateTime.fromISO(end, { zone: timezone })
  if (!from.isValid || !to.isValid || from.toISODate() !== start || to.toISODate() !== end || to <= from || to.diff(from, 'days').days > 42) throw new CalendarError('invalid_calendar_range', false, 0, 400)
  return { from: from.toUTC().toISO()!, to: to.toUTC().toISO()!, timezone }
}
const runtime = { transaction, provider }
/** Personal calendar contents never cross business/user boundaries or become job records. */
export async function connectedAgenda(businessId: string, userId: string, range: ReturnType<typeof externalRange>, rt: {
  transaction: <T>(fn: (db: PoolClient) => Promise<T>) => Promise<T>
  provider: (db: PoolClient, integration: Integration) => Pick<CalendarService, 'events'>
} = runtime): Promise<ConnectedAgenda> {
  const connections = await rt.transaction(async db => (await db.query(
    "select id from private.calendar_integrations where business_id=$1 and user_id=$2 and state in ('connected','reconnect_required') order by id", [businessId, userId],
  )).rows as { id: string }[])
  const parts = await Promise.all(connections.map(({ id }) => rt.transaction(async db => {
    const integration = (await db.query('select * from private.calendar_integrations where id=$1 and business_id=$2 and user_id=$3 for update', [id, businessId, userId])).rows[0] as Integration | undefined
    if (!integration || !['connected','reconnect_required'].includes(integration.state)) return { events: [], issues: [] }
    try {
      if (integration.state !== 'connected') throw new CalendarError('reconnect_required')
      const events = await rt.provider(db, integration).events(integration.calendar_id, range.from, range.to, range.timezone)
      const links = (await db.query('select calendar_event_id from private.calendar_event_links where integration_id=$1 and calendar_id=$2', [id, integration.calendar_id])).rows
      const exported = new Set(links.map(row => row.calendar_event_id))
      return { events: events.filter(event => !exported.has(event.id)).map(event => ({ ...event, id: `${id}:${event.id}`, provider: integration.provider, email: integration.email, calendar_name: integration.calendar_name })), issues: [] }
    } catch (error) {
      const issue = classify(error)
      if (issue.reason === 'authorization_revoked') await db.query("update private.calendar_integrations set state='reconnect_required',last_error=$2 where id=$1", [id, issue.reason])
      // Commit any rotated credentials even when the provider returns an error.
      return { events: [], issues: [{ provider: integration.provider, email: integration.email, reconnect: ['authorization_revoked','reconnect_required'].includes(issue.reason) }] }
    }
  })))
  return { events: parts.flatMap(part => part.events), issues: parts.flatMap(part => part.issues), connections: connections.length }
}
