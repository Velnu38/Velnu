/** Small stored ZIP writer for bounded archive parts; no compression dependency. */
const encoder=new TextEncoder()
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0})
export function crc32(bytes:Uint8Array){let c=0xffffffff;for(const byte of bytes)c=crcTable[(c^byte)&255]^(c>>>8);return (c^0xffffffff)>>>0}
export function storedZip(files:{name:string;bytes:Uint8Array}[]):Uint8Array{
 if(!files.length||files.length>1000)throw Error('Invalid archive file count')
 const names=new Set<string>(),local:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0,centralBytes=0
 for(const file of files){
  if(!/^[A-Za-z0-9_.\/-]{1,500}$/.test(file.name)||file.name.startsWith('/')||file.name.split('/').some(p=>!p||p==='.'||p==='..')||names.has(file.name))throw Error('Invalid archive filename')
  names.add(file.name);const name=encoder.encode(file.name),size=file.bytes.length,crc=crc32(file.bytes)
  if(size>22000000||offset+size>23000000)throw Error('Archive part exceeds its memory limit')
  const h=new Uint8Array(30+name.length),v=new DataView(h.buffer)
  v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,size,true);v.setUint32(22,size,true);v.setUint16(26,name.length,true);h.set(name,30)
  const c=new Uint8Array(46+name.length),w=new DataView(c.buffer)
  w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint16(14,33,true);w.setUint32(16,crc,true);w.setUint32(20,size,true);w.setUint32(24,size,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true);c.set(name,46)
  local.push(h,file.bytes);central.push(c);offset+=h.length+size;centralBytes+=c.length
 }
 const end=new Uint8Array(22),view=new DataView(end.buffer)
 view.setUint32(0,0x06054b50,true);view.setUint16(8,files.length,true);view.setUint16(10,files.length,true);view.setUint32(12,centralBytes,true);view.setUint32(16,offset,true)
 const result=new Uint8Array(offset+centralBytes+end.length);let at=0
 for(const chunk of [...local,...central,end]){result.set(chunk,at);at+=chunk.length}
 return result
}
export async function archiveHash(bytes:Uint8Array){const copy=new Uint8Array(bytes.length);copy.set(bytes);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',copy.buffer)),b=>b.toString(16).padStart(2,'0')).join('')}
