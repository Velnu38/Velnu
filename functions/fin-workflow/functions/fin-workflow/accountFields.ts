import {accountCatalog} from './catalog.ts'
import type {RecordSet,Step} from './protocol.ts'
import {itemTotal} from './protocol.ts'
import {normalizeSpokenMoney} from '../fin-assistant/core.ts'
type Field={type:string;max_length?:number;min?:number;max?:number;options?:readonly string[];resource?:string}
export function validateAccountStep(raw:any,sets:RecordSet[],evidence:string[]):Step{
 const resource=raw.fields?.resource;const cfg=(accountCatalog.resources as Record<string,any>)[resource];const create=raw.operation==='create_account_record',remove=raw.operation==='remove_account_record'
 if(!cfg||create&&!cfg.create||remove&&!cfg.remove||!create&&!remove&&!Object.keys(cfg.fields).length)throw Error('Use the account control shown for this action.')
 if(Object.entries(raw.fields).some(([key,value])=>!['resource','changes'].includes(key)&&value!==null&&!(Array.isArray(value)&&!value.length)))throw Error('Unsupported account action field.')
 const records=new Map(sets.flatMap(s=>s.rows.map(r=>[s.resource+':'+r.id,r] as const)))
 const record=raw.target&&records.get(raw.target)
 if(!create&&(!record||raw.target.split(':')[0]!==resource)||create&&raw.target!==null)throw Error('Read the exact account record before preparing changes.')
 const customer=raw.customer&&records.get(raw.customer)
 if(raw.customer&&(!create||!['properties','appointments'].includes(resource)||!customer||!raw.customer.startsWith('customers:')))throw Error('Choose the verified customer for this record.')
 if(create&&resource==='properties'&&!customer)throw Error('Choose the customer for this address.')
 if(!Array.isArray(raw.fields.changes)||raw.fields.changes.length>32||remove&&raw.fields.changes.length)throw Error('Invalid account field changes.')
 const values:Record<string,any>={};const related:Record<string,any>={};const spoken=normalizeSpokenMoney(evidence.join(' '));const numbers=[...spoken.matchAll(/(?:\$\s*)?(?<![\w.])\d[\d,]*(?:\.\d{1,2})?(?![\w.])/g)].map(m=>Number(m[0].replace(/[$,\s]/g,'')))
 for(const change of raw.fields.changes){const key=change.field,f:Field=cfg.fields[key];let value=change.value
  if(!f||Object.hasOwn(values,key)||!(value===null||typeof value==='string'))throw Error('This field cannot be edited by Fin.')
  if(value===null){if(!['text','email','url','reference','date','datetime'].includes(f.type)||(cfg.required||[]).includes(key))throw Error('Complete every required field.');values[key]=null;continue}
  if(value.length>16000)throw Error('This field is too long.')
  if(['boolean','integer','decimal','modules','weekdays','payment_links','line_items'].includes(f.type)){try{value=JSON.parse(value)}catch{throw Error('Invalid '+key.replaceAll('_',' ')+' value.')}}
  if(f.type==='boolean'&&typeof value!=='boolean')throw Error('Choose Yes or No for this field.')
  if(['integer','decimal'].includes(f.type)&&(typeof value!=='number'||!Number.isFinite(value)||value<(f.min??0)||value>(f.max??1e9)||f.type==='integer'&&!Number.isInteger(value)||f.type==='decimal'&&!/^-?\d+(\.\d{1,2})?$/.test(String(value))))throw Error('Check this numeric field.')
  if(['text','email','url','timezone','color','date','datetime','enum','reference'].includes(f.type)&&typeof value!=='string')throw Error('Invalid text field.')
  if(f.max_length&&value.length>f.max_length)throw Error('This field is too long.')
  if(f.type==='email'&&value&&!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value))throw Error('Check the email address.')
  if(f.type==='url'&&value){let u;try{u=new URL(value)}catch{throw Error('Use a complete HTTPS website address.')};if(u.protocol!=='https:'||u.username||u.password)throw Error('Use a complete HTTPS website address.')}
  if(f.type==='color'&&!/^#[0-9a-f]{6}$/i.test(value))throw Error('Choose a six-digit document color.')
  if(f.type==='timezone')try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format()}catch{throw Error('Choose a valid timezone.')}
  if(f.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw Error('Choose a valid date.')
  if(f.type==='datetime'&&(!/(Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value))))throw Error('Choose a date and time with timezone.')
  if(f.type==='enum'&&!f.options?.includes(value))throw Error('Choose an available field option.')
  if(f.type==='reference'){const row=records.get(value);if(!row||value.split(':')[0]!==f.resource)throw Error('Read the referenced account record first.');related[key]={reference:value,record:row};value=row.id}
  if(f.type==='modules'&&(!Array.isArray(value)||value.some(v=>!['calendar','jobs','billing','finances'].includes(v))))throw Error('Choose valid team access modules.')
  if(f.type==='weekdays'&&(!Array.isArray(value)||!value.length||value.some(v=>!Number.isInteger(v)||v<1||v>7)))throw Error('Choose valid working days.')
  if(f.type==='payment_links'){if(!Array.isArray(value)||value.length>4)throw Error('Choose valid payment links.');for(const link of value){const hosts:Record<string,string[]>= {venmo:['venmo.com','www.venmo.com'],paypal:['paypal.me','www.paypal.me','paypal.com','www.paypal.com'],stripe:['buy.stripe.com','checkout.stripe.com'],cashapp:['cash.app']};let url;try{url=new URL(link.url)}catch{throw Error('Invalid payment link.')};if(!hosts[link.provider]?.includes(url.hostname)||url.protocol!=='https:'||url.username||url.password)throw Error('Use a supported payment provider link.')}}
  if(f.type==='line_items'){if(!Array.isArray(value)||!value.length||value.length>50)throw Error('Provide the complete list of line items.');for(const line of value){if(Object.keys(line).some(k=>!['description','quantity','unit_price','tax_rate'].includes(k)))throw Error('Invalid line item.');line.quantity=String(line.quantity);line.unit_price=String(line.unit_price);line.tax_rate=String(line.tax_rate);for(const part of ['quantity','unit_price','tax_rate'])if(evidence.length&&!numbers.includes(Number(line[part]))&&!(part==='quantity'&&Number(line[part])===1)&&!(part==='tax_rate'&&Number(line[part])===0)&&!(record?.items as any[]||[]).some(i=>i.description===line.description&&Number(i[part])===Number(line[part])))throw Error('Specify each changed quantity, price and tax rate.')}itemTotal(value)}
  if(evidence.length&&['amount','default_tax_rate','pricing_adjustment_percent'].includes(key)&&!numbers.includes(Number(value)))throw Error('State the amount or rate to change.')
  values[key]=value
 }
 if(!remove&&!Object.keys(values).length)throw Error('Specify at least one change.')
 if(create)for(const required of cfg.required||[])if(values[required]===undefined||values[required]===null||values[required]==='')throw Error('Provide '+required.replaceAll('_',' ')+'.')
 const combined={...record,...values};if(combined.starts_at&&combined.ends_at&&Date.parse(combined.ends_at)<=Date.parse(combined.starts_at))throw Error('End time must be after start time.')
 const label=String(record?.invoice_number||record?.estimate_number||record?.change_order_number||record?.name||record?.title||record?.label||record?.email||[record?.first_name,record?.last_name].filter(Boolean).join(' ')||cfg.label)
 return {operation:raw.operation,target:raw.target,customer:raw.customer,fields:{resource,values},label,request_id:crypto.randomUUID(),...(record?{record,expected:String(record._version||record.updated_at||JSON.stringify(record))}:{}),...(customer?{customer_record:customer}:{}),...(Object.keys(related).length?{related}:{}),...(values.items?{total:itemTotal(values.items)}:{})} as Step
}
