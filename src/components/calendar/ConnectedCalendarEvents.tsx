import { DateTime } from 'luxon'
import type { ConnectedAgenda, ConnectedEvent } from '../../lib/calendarTypes'
function eventUrl(value: string | null) {
  try { const url = new URL(value || ''); return url.protocol === 'https:' && ['calendar.google.com','www.google.com','outlook.office365.com','outlook.office.com','outlook.live.com'].includes(url.hostname) ? url.href : null } catch { return null }
}
function descriptionText(value: string) {
  // Template contents stay inert: provider HTML cannot load images or execute code.
  const template = document.createElement('template')
  template.innerHTML = value
  const doc = template.content
  doc.querySelectorAll('script,style').forEach(node => node.remove())
  doc.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
  doc.querySelectorAll('p,div,li').forEach(node => node.append('\n'))
  return doc.textContent?.trim() || ''
}
export default function ConnectedCalendarEvents({events,issues,connections,loading,error,zone,onRetry}:{events:ConnectedEvent[];issues:ConnectedAgenda['issues'];connections:number;loading:boolean;error:string;zone:string;onRetry:()=>void}) {
  return <section className="calendar-connected" aria-label="Your connected calendar events">
    <div className="calendar-list-heading"><h3>Your connected calendars</h3><span>{events.length}</span></div>
    {loading ? <p role="status" className="calendar-empty">Loading connected events…</p> : error ? <p role="status" className="calendar-empty">{error} <button type="button" className="text-button" onClick={onRetry}>Retry connected calendars</button></p> : <>
      {issues.map(issue=><p role="status" className="calendar-empty" key={issue.provider}>{issue.provider === 'google' ? 'Google' : 'Outlook'} · {issue.email}: {issue.reconnect ? <>Reconnect in <a href="/?view=settings&section=calendar">Calendar Connections</a> to see these events.</> : <>Events could not be loaded. <button type="button" className="text-button" onClick={onRetry}>Retry connected calendars</button></>}</p>)}
      {!events.length && !issues.length && <p className="calendar-empty">{connections ? 'No connected-calendar events for this day.' : <>Connect Google or Outlook in <a href="/?view=settings&section=calendar">Calendar Connections</a> to see your other calendar events here.</>}</p>}
      {!!events.length && <ul className="calendar-work-list">{events.map(item=>{
        const url = eventUrl(item.url)
        return <li key={item.id}><article className="calendar-event connected"><time>{item.all_day ? 'All day' : DateTime.fromISO(item.starts_at).setZone(zone).toFormat('h:mm a')}</time><span><strong>{item.title}</strong><small>{item.provider === 'google' ? 'Google' : 'Outlook'} · {item.email} · {item.calendar_name}</small>{!item.all_day && <small>Until {DateTime.fromISO(item.ends_at).setZone(zone).toFormat('MMM d, h:mm a')}</small>}{item.location && <small className="calendar-address">{item.location}</small>}{item.description && <p className="calendar-description">{descriptionText(item.description)}</p>}{url && <a className="text-button" href={url} target="_blank" rel="noopener noreferrer">Open in {item.provider === 'google' ? 'Google Calendar' : 'Outlook'}</a>}</span></article></li>
      })}</ul>}
    </>}
  </section>
}
