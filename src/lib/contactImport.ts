export type ImportContact={id:string;first_name:string;last_name:string|null;email:string|null;phone:string|null}
export const contactFileLimit=8*1024*1024
function parts(value:string){const out:string[]=[];let token='',escape=false;for(const ch of value){if(escape){token+='\\'+ch;escape=false}else if(ch==='\\')escape=true;else if(ch===';'){out.push(token);token=''}else token+=ch}out.push(token);return out.map(unescape)}
function unescape(value:string){return value.replace(/\\[nN]/g,' ').replace(/\\([,;\\])/g,'$1').trim()}
function decoded(value:string,header:string){
  if(/ENCODING=QUOTED-PRINTABLE/i.test(header)){const bytes:number[]=[];for(let i=0;i<value.length;i++){if(value[i]==='='&&/^[0-9A-F]{2}$/i.test(value.slice(i+1,i+3))){bytes.push(parseInt(value.slice(i+1,i+3),16));i+=2}else bytes.push(...new TextEncoder().encode(value[i]))}return new TextDecoder().decode(new Uint8Array(bytes))}
  return value
}
export function normalizePhoneContact(value:{name?:string[];email?:string[];tel?:string[]},id:string):ImportContact|null {
  const name=value.name?.find(x=>x.trim())?.trim()||'';if(!name)return null
  const words=name.split(/\s+/),mail=value.email?.find(x=>/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(x.trim()))?.trim()||null
  const phone=value.tel?.find(x=>x.trim())?.trim().replace(/^tel:/i,'')||null
  const first=words[0],last=words.slice(1).join(' ')||null
  if(first.length>160||(last?.length||0)>160||(mail?.length||0)>254||(phone?.length||0)>40)return null
  return {id,first_name:first,last_name:last,email:mail,phone}
}
export function parseContactCards(text:string,makeId:()=>string):{contacts:ImportContact[];ignored:number}{
  if(new TextEncoder().encode(text).length>contactFileLimit)throw new Error('Choose a contacts file smaller than 8 MB. Export a smaller list without photos if needed.')
  if(text.includes('\0'))throw new Error('This is not a supported contacts file. Choose an exported .vcf file.')
  // Unfold vCards and quoted-printable soft lines without touching photo padding.
  const lines:string[]=[];let quoted=false
  for(const line of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
    if(lines.length&&quoted&&lines[lines.length-1].endsWith('='))lines[lines.length-1]=lines[lines.length-1].slice(0,-1)+line
    else if(lines.length&&/^[ \t]/.test(line))lines[lines.length-1]+=line.slice(1)
    else{lines.push(line);quoted=/;ENCODING=QUOTED-PRINTABLE/i.test(line.slice(0,line.indexOf(':')))}
  }
  const input=lines.join('\n'),cards:string[]=[],markers=/^(BEGIN|END):VCARD[ \t]*$/gmi
  let from=-1,match:RegExpExecArray|null
  while((match=markers.exec(input))){
    if(match[1].toUpperCase()==='BEGIN'){
      if(from>=0)throw new Error('A contact card is incomplete. Export the contacts again.')
      from=match.index
    }else if(from>=0){cards.push(input.slice(from,markers.lastIndex));from=-1;if(cards.length>2000)throw new Error('Import up to 2,000 contacts at a time. Export a smaller contacts list.')}
  }
  if(from>=0)throw new Error('A contact card is incomplete. Export the contacts again.')
  if(!cards.length)throw new Error('No contacts were found. Choose a vCard (.vcf) export from Contacts.')
  if(cards.length>2000)throw new Error('Import up to 2,000 contacts at a time. Export a smaller contacts list.')
  const contacts:ImportContact[]=[],seen=new Set<string>();let ignored=0
  for(const card of cards){const name:string[]=[],email:string[]=[],tel:string[]=[];let structured:string[]|undefined,org=''
    for(const line of card.split(/\r?\n/)){const colon=line.indexOf(':');if(colon<0)continue;const header=line.slice(0,colon),key=header.split(';')[0].replace(/^item\d+\./i,'').toUpperCase(),value=decoded(line.slice(colon+1),header)
      if(key==='FN')name.push(unescape(value));if(key==='N')structured=parts(value);if(key==='ORG')org=parts(value).filter(Boolean).join(' ');if(key==='EMAIL')email.push(unescape(value));if(key==='TEL')tel.push(unescape(value))
    }
    if(!name.some(Boolean))name.push(structured?[structured[1],structured[2],structured[0]].filter(Boolean).join(' '):org)
    const parsed=normalizePhoneContact({name,email,tel},makeId());if(!parsed){ignored++;continue}
    const fingerprint=JSON.stringify([parsed.first_name.toLowerCase(),parsed.last_name?.toLowerCase(),parsed.email?.toLowerCase(),parsed.phone?.replace(/\D/g,'')])
    if(seen.has(fingerprint)){ignored++;continue}seen.add(fingerprint);contacts.push(parsed)
  }
  if(!contacts.length)throw new Error('No contacts with usable names were found in this file.')
  return {contacts,ignored}
}
