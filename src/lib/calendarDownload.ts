const escape=(value:string)=>value.replaceAll('\\','\\\\').replaceAll('\r','').replaceAll('\n','\\n').replaceAll(',','\\,').replaceAll(';','\\;')
const stamp=(iso:string)=>new Date(iso).toISOString().replaceAll('-','').replaceAll(':','').replace(/\.\d{3}/,'')
export function appointmentIcs({id,title,start,end,address,created}:{id:string;title:string;start:string;end:string;address?:string|null;created?:string}) {
  if(!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start))throw new Error('A valid appointment is required.')
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Finviant//Appointments//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:${escape(id)}@finviant.com`,`DTSTAMP:${stamp(created || new Date().toISOString())}`,`DTSTART:${stamp(start)}`,`DTEND:${stamp(end)}`,`SUMMARY:${escape(title)}`,`LOCATION:${escape(address || '')}`,'STATUS:CONFIRMED','END:VEVENT','END:VCALENDAR']
  return lines.join('\r\n')+'\r\n'
}
