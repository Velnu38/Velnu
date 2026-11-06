import { customerOptionName, normalizeCustomerSearch, type CustomerOption } from './customerSuggestions'
import {normalizeSpokenMoney as normalizeWords} from '../../supabase/functions/fin-assistant/core'
import {parseQuickInvoice,isQuickInvoiceCommand} from './quickInvoice'
export type VoiceKind='invoice'|'estimate'
export type VoiceLine={description:string;amount:string;quantity:string}
export type VoiceSeed={kind:VoiceKind;customerName:string;lines:VoiceLine[];statedTotal:string|null;taxRate:string|null;warnings:string[]}
export type FinInvoiceDraft = { command: string; seed: VoiceSeed; customerId?: string }

function invoiceRequest(command: string) {
 const request = command.trim()
  .replace(/^(?:(?:hey\s+fin|fin)[,\s]+)?(?:(?:can|could|would) you\s+|i (?:need|want) to\s+)?(?:please\s+)?/i, '')
  .replace(/^i (?:need|want)\s+(?=(?:an?\s+)?new\s+invoice\b)/i, 'open ')
  .replace(/^(?:open|go to)\s+(?:the\s+)?invoices?(?:\s+page)?\s*(?:,\s*(?:and\s+)?|and\s+|then\s+)(?:then\s+)?/i, '')
  .replace(/\s+please[.!?]*$/i, '')
  .replace(/\s+(?:and|then)\s+(?:email|text|send)\s+(?:it|the invoice)(?:\s+to (?:them|the customer))?[.!?]*$/i, '')
 const create = /^(?:(?:create|make|draft|prepare|write|generate|start)\s+(?:me\s+)?(?:(?:an?|the)\s+)?(?:new\s+)?|(?:open\s+(?:an?\s+)?)?new\s+)invoice\b/i
 const linked = /\b(?:from|using)\s+(?:(?:an?|the|my)\s+)?(?:approved\s+)?(?:estimate|quote|job|invoice)\b/i
 const compound = /\b(?:and|then)\s+(?:schedule|convert|record a payment|create (?:another|a second|a customer))\b/i
 return create.test(request) && !linked.test(request) && !compound.test(request) ? request : null
}

export function finInvoiceDraft(command: string, customerId?: string): FinInvoiceDraft | null {
 const request = invoiceRequest(command)
 return request ? {command, seed: parseVoiceDocument(request), customerId} : null
}

export function resolveFinInvoiceSeed(draft: FinInvoiceDraft, customers: CustomerOption[]): VoiceSeed {
 if (draft.seed.customerName) return draft.seed
 const request = invoiceRequest(draft.command)
 const recipient = request?.match(/^(.*?\binvoice\s+(?:for|to)\s+)(.+)$/is)
 if (!recipient) return draft.seed
 // A spoken request may omit the separator between the customer's name and the first charge.
 const tokens = [...recipient[2].matchAll(/\S+(?:\s+|$)/g)]
 const names = new Set(customers.flatMap(customer => [customerOptionName(customer), customer.company || '']).map(normalizeCustomerSearch))
 for (const token of tokens.reverse()) {
  const split = token.index + token[0].length
  const name = recipient[2].slice(0, split).trim()
  const charges = recipient[2].slice(split)
  if (names.has(normalizeCustomerSearch(name)) && /\$|\bdollars?\b/i.test(normalizeWords(charges))) {
   return parseVoiceDocument(recipient[1] + name + ': ' + charges)
  }
 }
 return draft.seed
}

export function voiceDocumentKind(text:string):VoiceKind{return /\b(?:estimate|quote)\b/i.test(text.match(/\b(?:invoice|bill|estimate|quote)\b/i)?.[0]||'')?'estimate':'invoice'}
export function isVoiceDocumentCommand(text:string){
 if(/\bconvert\b|\bfrom\s+(?:an?\s+)?(?:estimate|invoice)\b/i.test(text))return false
 return isQuickInvoiceCommand(text)||/\b(?:create|make|draft|prepare|write|generate|start)\b[\s\S]{0,100}\b(?:estimate|quote)\b|\b(?:estimate|quote)\s+(?:for|to)\b/i.test(text)
}
function clean(value:string){return value.replace(/^[\s,.;:+-]+|[\s,.;:+-]+$/g,'').replace(/^(?:(?:and|plus|add|for|at|with|including|then|also)\s+)+/i,'').replace(/\s+(?:and|plus|at|for)$/i,'').trim()}
export function parseVoiceDocument(input:string):VoiceSeed{
 const raw=input.trim().replace(/[^\S\n]+/g,' '),command=normalizeWords(raw),kind=voiceDocumentKind(raw)
 const normalized=command.replace(/\b(?:estimate|quote)\b/i,'invoice'),legacy=parseQuickInvoice(normalized)
 const warnings:string[]=[];const unsafe=/\b(?:refund|credit|discount|minus|negative|deposit|paid|deduct|less|payment)\b/i.test(command)
 if(unsafe)warnings.push('Payments, deposits, discounts or negative amounts need manual review. Enter each service charge below.')
 // Customer identity must never consume a price. A missing customer is a
 // normal draft state: preserve the entire charge text and ask in review.
 const candidate=raw.match(/\b(?:invoice|bill|estimate|quote)\s+(?:for|to)\s+(.+?)(?=\s+(?:for|due|total|amount|at|with|including|on|description|service|work|to)\b|\s+\$|[,;:]|[.!?]+$|$)/i)
 const candidateName=candidate?.[1]?.trim()||''
 const after=candidate?raw.slice(candidate.index!+candidate[0].length):''
 const startsWithCharge=/^[\s$+−-]*\d/.test(candidateName)
 const hasCurrency=/\$|^\d[\d,.]*\s+dollars?$/i.test(normalizeWords(candidateName))
 // A service directly followed by a price is ambiguous with a customer's
 // name. Only consume explicit name separators; Fin can interpret the rest.
 const namedBoundary = /^\s*(?:for\b|to\b|due\b|with\b|including\b|total\b|[:;,]|[.!?]*$)/i.test(after)
 const customerMatch=candidate&&!startsWithCharge&&!hasCurrency&&namedBoundary?candidate:null
 const customerName=customerMatch?candidateName:''
 const headerEnd=customerMatch?customerMatch.index!+customerMatch[0].length:0
 let body=headerEnd?normalizeWords(raw.slice(headerEnd)):command.replace(/^.*?\b(?:invoice|estimate|quote|bill)\b\s*/i,'')
 let statedTotal:string|null=null
 // A stated total is a check against the sum, never an additional charge.
 body=body.replace(/\b(?:for\s+a\s+)?(?:(?:grand|sub)\s*total|total)(?:\s+(?:of|is|comes\s+to))?\s*[:=]?\s*(\$\s*\d[\d,.]*|\d[\d,.]*\s+dollars?)\b/gi,(whole,money:string)=>{
  if(/\bsub\s*total\b/i.test(whole))return '';const check=parseQuickInvoice('Create invoice for Test for '+money);if(!check.amount){statedTotal=/^(?:\$\s*)?0(?:\.0{1,2})?(?:\s+dollars?)?$/.test(money.trim())?'0':'';warnings.push('The spoken total needs review.');return ''}if(statedTotal!==null)warnings.push('More than one total was stated.');statedTotal=check.amount;return ''
 })
 const explicitNoTax=/\b(?:no\s+tax|without\s+tax|tax\s+exempt)\b/i.test(body)
 const taxMatch=body.match(/(?:\b(\d+(?:\.\d{1,2})?)\s*(?:%|percent)\s*(?:sales\s+)?tax\b|\btax\s*(?:at|of)?\s*(\d+(?:\.\d{1,2})?)\s*(?:%|percent))/i)
 let taxRate=explicitNoTax?'0':taxMatch?taxMatch[1]||taxMatch[2]:null
 if(taxRate!==null&&(!Number.isFinite(Number(taxRate))||Number(taxRate)>100)){warnings.push('Tax percentage needs review.');taxRate=''}
 if(taxMatch)body=body.replace(taxMatch[0],'');body=body.replace(/\b(?:no\s+tax|without\s+tax|tax\s+exempt)\b/gi,'').replace(/\b(?:due|expires?|expiration)\b.*$/i,'')
 const clauses=body.split(/\s*(?:;|\n|\+|,(?!\d)|\b(?:and|plus|next line|new line|also add)\b)\s*/i).map(clean).filter(Boolean)
 const lines:VoiceLine[]=[]
 for(const clause of clauses){
  const matches=[...clause.matchAll(/\$\s*([+−-]?\s*\d[\d,.]*(?:[eE][+-]?\d+)?)\b(?:\s+dollars?\b)?|(?<![\w.])([+−-]?\s*\d[\d,.]*(?:[eE][+-]?\d+)?)\s+dollars?\b/gi)]
  if(!matches.length){if(/\d|dollars?|cents\b/i.test(clause))warnings.push('An amount could not be assigned confidently. Check the unpriced line.');lines.push({description:clause,amount:'',quantity:'1'});continue}
  if(matches.length>1){warnings.push('Separate these charges into individual lines before saving.');for(const match of matches)lines.push({description:'',amount:'',quantity:'1'});continue}
  const match=matches[0];const seed=parseQuickInvoice('Create invoice for Test for '+clause)
  let description=clean(clause.slice(0,match.index)+clause.slice(match.index!+match[0].length)),quantity='1',amount=seed.amount||(/^(?:\$\s*)?0(?:\.0{1,2})?(?:\s+dollars?)?$/i.test(match[0].trim())?'0':'')
  // Explicit unit pricing: "3 shrubs at $25 each". Flat service charges stay quantity one.
  if(/\beach\b|\bper\s+(?:item|unit|hour)\b/i.test(clause)){
   const qty=description.match(/^(\d+(?:\.\d{1,2})?)\s+(.+?)\s*(?:at)?\s*(?:each|per\s+(?:item|unit|hour))$/i)
   if(qty&&Number(qty[1])>0&&Number(qty[1])<=100000){quantity=qty[1];description=clean(qty[2].replace(/\s+at$/i,''))}else{amount='';warnings.push('Check the quantity and unit price for the each/per-unit charge.')}
  }
  if(/\btax\b/i.test(description)){amount='';warnings.push('For tax, use a percentage in the tax control instead of a separate charge.')}
  if(unsafe)amount=''
  if(!amount&&seed.amount!== '0')warnings.push('An amount needs correction before saving.')
  lines.push({description,amount,quantity})
 }
 if(!lines.length)lines.push({description:legacy.description,amount:unsafe?'':statedTotal||legacy.amount,quantity:'1'})
 return {kind,customerName,lines,statedTotal,taxRate,warnings:[...new Set([...warnings,...(lines.length>50?['A document supports at most 50 lines. Split this request into separate documents before saving.']:[])])]}
}
