import {archiveCatalog,archiveCatalogV1} from '../../../shared/archiveCatalog.ts'
import {archiveHash,storedZip} from '../../../shared/archiveZip.ts'
export type ArchiveClaim={schema_version?:1|2;archive_id:string;business_id:string;part_no:number;part_count:number;kind:'records'|'file';lease:string;created_at:string;expires_at:string;counts:Record<string,number>;rows:{collection:string;data:Record<string,unknown>}[]}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const buckets=['finviant-record-photos','velnu-business-logos','finviant-document-pdfs']
export async function assembleArchivePart(claim:ArchiveClaim,download:(file:Record<string,unknown>)=>Promise<Uint8Array>){
 if(!UUID.test(claim.archive_id)||!UUID.test(claim.business_id)||!UUID.test(claim.lease)||!Number.isInteger(claim.part_no)||claim.part_no<1||!Array.isArray(claim.rows)||!claim.rows.length)throw Error('Invalid archive claim')
 const version=claim.schema_version??1
 if(version!==1&&version!==2)throw Error('Unsupported archive schema version')
 const catalog=version===1?archiveCatalogV1:archiveCatalog
 const files:{name:string;bytes:Uint8Array}[]=[],entries:{name:string;sha256:string;bytes:number;records?:number;source?:Record<string,unknown>}[]=[],encoder=new TextEncoder()
 if(claim.kind==='file'){
  if(claim.rows.length>20||claim.rows.some(row=>row.collection!=='storage_files'))throw Error('Invalid archive file claim')
  for(const {data:file} of claim.rows){
   const path=String(file.path||''),bucket=String(file.bucket||'')
   if(!buckets.includes(bucket)||!path.startsWith(claim.business_id+'/')||path.includes('..')||!Number.isSafeInteger(file.byte_size)||Number(file.byte_size)<0||Number(file.byte_size)>10000000)throw Error('Invalid source file')
  }
  if(claim.rows.reduce((sum,row)=>sum+Number(row.data.byte_size),0)>18000000)throw Error('Source part is too large')
  for(const {data:file} of claim.rows){
   const bytes=await download(file);if(bytes.length!==file.byte_size)throw Error('A source file changed. Request a new archive.')
   const hash=await archiveHash(bytes)
   if(file.sha256!=null&&file.sha256!==hash)throw Error('Immutable source file hash mismatch')
   const name='files/'+file.bucket+'/'+file.path;files.push({name,bytes});entries.push({name,sha256:hash,bytes:bytes.length,source:file})
  }
 }else if(claim.kind==='records'){
  const groups=new Map<string,Record<string,unknown>[]>()
  for(const row of claim.rows){if(!/^(public|private)\.[a-z_]+$/.test(row.collection))throw Error('Invalid record collection');const group=groups.get(row.collection)||[];group.push(row.data);groups.set(row.collection,group)}
  for(const [collection,rows] of groups){const name='records/'+collection+'.part-'+String(claim.part_no).padStart(6,'0')+'.jsonl',bytes=encoder.encode(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');files.push({name,bytes});entries.push({name,sha256:await archiveHash(bytes),bytes:bytes.length,records:rows.length})}
 }else throw Error('Invalid archive part type')
 if(claim.part_no===1){
  const name='schema/catalog.json',bytes=encoder.encode(JSON.stringify(catalog,null,2)+'\n')
  files.push({name,bytes});entries.push({name,sha256:await archiveHash(bytes),bytes:bytes.length})
 }
 const manifest={format:'finviant-owner-archive',schema_version:version,archive_id:claim.archive_id,business_id:claim.business_id,snapshot_at:claim.created_at,expires_at:claim.expires_at,part:claim.part_no,total_parts:claim.part_count,collection_counts:{...Object.fromEntries(catalog.map(c=>[c.collection,0])),storage_files:0,...claim.counts},files:entries,
  excluded:['Passwords, provider credentials and live authorization-token fields','Other users’ private Fin conversations','Internal platform support notes and operational security logs','Delivery payloads, SMS bodies and snapshots containing bearer links; selected recipient/status/timestamp fields are retained'],
  instructions:'Keep every ZIP part for this archive ID. Unzip into one folder. Record files are UTF-8 JSON Lines; concatenate parts of the same collection to recover every row. File hashes use SHA-256. This is a record archive, not a one-click restore package.'}
 files.push({name:'manifests/part-'+String(claim.part_no).padStart(6,'0')+'.json',bytes:encoder.encode(JSON.stringify(manifest,null,2)+'\n')})
 const bytes=storedZip(files);return {bytes,sha256:await archiveHash(bytes),entries}
}
