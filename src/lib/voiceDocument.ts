import {parseQuickInvoice,isQuickInvoiceCommand} from './quickInvoice'
export type VoiceKind='invoice'|'estimate'
export type VoiceLine={description:string;amount:string;quantity:string}
export type VoiceSeed={kind:VoiceKind;customerName:string;lines:VoiceLine[];statedTotal:string|null;taxRate:string|null;warnings:string[]}
export function voiceDocumentKind(text:string):VoiceKind{return /\b(?:estimate|quote)\b/i.test(text.match(/\b(?:invoice|bill|estimate|quote)\b/i)?.[0]||'')?'estimate':'invoice'}
export function isVoiceDocumentCommand(text:string){
 if(/\bconvert\b|\bfrom\s+(?:an?\s+)?(?:estimate|invoice)\b/i.test(text))return false
 return isQuickInvoiceCommand(text)||/\b(?:create|make|draft|prepare|write|generate|start)\b[\s\S]{0,100}\b(?:estimate|quote)\b|\b(?:estimate|quote)\s+(?:for|to)\b/i.test(text)
}
const small:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90}
function underHundred(words:string[]):number|null{
 if(words.length===1)return small[words[0]]??null
 if(words.length===2&&small[words[0]]>=20&&small[words[0]]%10===0&&small[words[1]]>0&&small[words[1]]<10)return small[words[0]]+small[words[1]]
 return null
}
function group(words:string[]):number|null{
 const h=words.indexOf('hundred');if(h<0)return underHundred(words)
 if(h!==1||small[words[0]]<1||small[words[0]]>9)return null
 const rest=words.slice(2);const n=rest.length?underHundred(rest):0;return n===null?null:small[words[0]]*100+n
}
function wordsNumber(words:string[]):number|null{
 words=words.filter(w=>w!=='and');let sum=0,lastScale=Infinity,start=0
 for(let i=0;i<words.length;i++){const scale=words[i]==='million'?1000000:words[i]==='thousand'?1000:0;if(!scale)continue;if(scale>=lastScale)return null;const n=group(words.slice(start,i));if(n===null||n<=0)return null;sum+=n*scale;lastScale=scale;start=i+1}
 if(start<words.length){const n=group(words.slice(start));if(n===null)return null;sum+=n}else if(!sum)return null
 return sum
}
function normalizeWords(text:string){
 const word='(?:'+Object.keys(small).join('|')+'|hundred|thousand|million|point)'
 return text.replace(new RegExp('\\b('+word+'(?:[ -]+(?:'+word+'|and))*)\\s+(dollars?|cents|percent)\\b','gi'),(whole,phrase:string,unit:string)=>{
  const parts=phrase.toLowerCase().split(/[ -]+/),point=parts.indexOf('point');const integer=wordsNumber(point<0?parts:parts.slice(0,point));if(integer===null)return whole
  let value=String(integer);if(point>=0){const decimals=parts.slice(point+1);if(decimals.length<1||decimals.length>2||decimals.some(w=>small[w]===undefined||small[w]>9))return whole;value+='.'+decimals.map(w=>small[w]).join('')}
  return value+' '+unit
 }).replace(/\b(\d+)\s+dollars?\s+(?:and\s+)?(\d{1,2})\s+cents\b/gi,(_,a,b)=>`${a}.${b.padStart(2,'0')} dollars`)
}
function clean(value:string){return value.replace(/^[\s,.;:+-]+|[\s,.;:+-]+$/g,'').replace(/^(?:(?:and|plus|add|for|at|with|including|then|also)\s+)+/i,'').replace(/\s+(?:and|plus|at|for)$/i,'').trim()}
export function parseVoiceDocument(input:string):VoiceSeed{
 const raw=input.trim().replace(/[^\S\n]+/g,' '),command=normalizeWords(raw),kind=voiceDocumentKind(raw)
 const normalized=command.replace(/\b(?:estimate|quote)\b/i,'invoice'),legacy=parseQuickInvoice(normalized)
 const warnings:string[]=[];const unsafe=/\b(?:refund|credit|discount|minus|negative|deposit|paid|deduct|less|payment)\b/i.test(command)
 if(unsafe)warnings.push('Payments, deposits, discounts or negative amounts need manual review. Enter each service charge below.')
 const customerMatch=raw.match(/\b(?:invoice|bill|estimate|quote)\s+(?:for|to)\s+(.+?)(?=\s+(?:for|due|total|amount|at|with|including|on|description|service|work|to)\b|\s+\$|[,.;:!?]|$)/i)
 const customerName=customerMatch?.[1]?.trim()||legacy.customerName
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
  let description=clean(clause.slice(0,match.index)+clause.slice(match.index!+match[0].length)),quantity='1',amount=seed.amount
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
