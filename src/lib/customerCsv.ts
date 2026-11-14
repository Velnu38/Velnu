import {contactFileLimit, type ImportContact} from './contactImport'

/** RFC-style quoted fields, including embedded commas, quotes and newlines. */
export function parseCustomerCsv(text:string, makeId:()=>string):{contacts:ImportContact[];ignored:number} {
  if(new TextEncoder().encode(text).length>contactFileLimit)throw new Error('Choose a CSV smaller than 8 MB.')
  if(text.includes('\0'))throw new Error('Choose a text CSV file.')
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false
  const input=text.replace(/^\uFEFF/,'')
  for(let i=0;i<input.length;i++){
    const c=input[i]
    if(quoted){if(c==='"'){if(input[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=c;continue}
    if(c==='"'){if(cell||closed)throw new Error('Check the CSV quotation marks.');quoted=true;continue}
    if(c===','||c==='\n'||c==='\r'){
      row.push(cell);cell='';closed=false
      if(c!==','){if(row.some(x=>x.trim()))rows.push(row);row=[];if(c==='\r'&&input[i+1]==='\n')i++;if(rows.length>2001)throw new Error('Import up to 2,000 customers at a time.')}
    }else{if(closed&&c.trim())throw new Error('Check the CSV quotation marks.');if(!closed)cell+=c}
  }
  if(quoted)throw new Error('A CSV field has an unclosed quotation mark.')
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row)
  if(rows.length<2)throw new Error('Include a header row and at least one customer.')
  if(rows.length>2001)throw new Error('Import up to 2,000 customers at a time.')
  const headers=rows.shift()!.map(x=>x.trim().toLowerCase().replace(/[ _-]/g,''))
  if(new Set(headers).size!==headers.length)throw new Error('Use one column for each CSV header.')
  if(!headers.some(x=>['firstname','lastname','name','company'].includes(x)))throw new Error('Include First name, Last name, Name, or Company headers.')
  const contacts:ImportContact[]=[],seen=new Set<string>();let ignored=0
  rows.forEach((cells,index)=>{
    if(cells.length!==headers.length)throw new Error(`CSV row ${index+2} has a different number of columns.`)
    const get=(key:string)=>{const value=cells[headers.indexOf(key)]?.trim()||'';return /^'[=+\-@\t\r]/.test(value)?value.slice(1):value}
    const full=get('name').split(/\s+/);const company=get('company')
    const first=get('firstname')||(!get('lastname')?full[0]:'')||(!get('lastname')?company:''),last=get('lastname')||full.slice(1).join(' ')
    const email=get('email'),phone=get('phone')||get('mobile')
    if(!(first||last||company)||first.length>160||last.length>160||company.length>160||phone.length>40||email.length>254||(email&&!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)))throw new Error(`Check the name, company, email and phone in CSV row ${index+2}.`)
    const fingerprint=JSON.stringify([first.toLowerCase(),last.toLowerCase(),company.toLowerCase(),email.toLowerCase(),phone.replace(/\D/g,'')])
    if(seen.has(fingerprint)){ignored++;return}seen.add(fingerprint)
    contacts.push({id:makeId(),first_name:first,last_name:last||null,company:company||null,email:email||null,phone:phone||null})
  })
  return {contacts,ignored}
}

/** Prevent spreadsheet formulas when a recipient opens exported customer text. */
export function csvCell(value:unknown){const text=String(value??'');return '"'+(/^[\s]*[=+\-@\t\r]/.test(text)?"'"+text:text).replace(/"/g,'""')+'"'}
export function downloadCsv(filename:string,headers:string[],rows:unknown[][]){
  const blob=new Blob(['\uFEFF'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
