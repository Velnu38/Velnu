import {DateTime} from 'luxon'
import './document-review.css'

export type DocumentDates={created_at?:string|null;updated_at?:string|null;sent_at?:string|null;paid_at?:string|null}
export function DocumentTime({value,timezone}:{value?:string|null;timezone?:string}) {
 const date=value?DateTime.fromISO(value).setZone(timezone||'America/New_York'):null
 return date?.isValid?<time dateTime={value!}>{date.toFormat('MMM d, yyyy · h:mm a ZZZZ')}</time>:<span>Not recorded</span>
}
export function CreatedStamp({value,timezone}:{value?:string|null;timezone?:string}) {
 return <small className="document-created">Created <DocumentTime value={value} timezone={timezone}/></small>
}
export default function DocumentRecord({dates,timezone,customerId,customerName}:{dates:DocumentDates;timezone?:string;customerId:string;customerName:string}) {
 const changed=dates.updated_at&&dates.created_at&&Date.parse(dates.updated_at)!==Date.parse(dates.created_at)
 return <section className="document-record" aria-label="Document record"><div className="document-record-heading"><h2>Document record</h2><a href={`/?view=customers&document=${encodeURIComponent(customerId)}`}>Customer record: {customerName} <span aria-hidden="true">↗</span></a></div>
  <dl><div><dt>Created</dt><dd><DocumentTime value={dates.created_at} timezone={timezone}/></dd></div>
   {changed&&<div><dt>Last updated</dt><dd><DocumentTime value={dates.updated_at} timezone={timezone}/></dd></div>}
   {dates.sent_at&&<div><dt>Sent</dt><dd><DocumentTime value={dates.sent_at} timezone={timezone}/></dd></div>}
   {dates.paid_at&&<div><dt>Paid</dt><dd><DocumentTime value={dates.paid_at} timezone={timezone}/></dd></div>}
  </dl>
 </section>
}
