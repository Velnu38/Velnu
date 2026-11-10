import {supabase} from '../lib/supabase'
import {archiveHash} from '../../shared/archiveZip'
export type ArchivePart={part_no:number;kind:'records'|'file';state:'pending'|'ready';sha256:string|null;byte_size:number|null;entries:unknown[]|null}
export type OwnerArchive={id:string;business_id:string;status:'building'|'ready'|'expired';created_at:string;expires_at:string;counts:Record<string,number>;record_count:number;file_count:number;part_count:number;ready_count:number;page:number;parts:ArchivePart[]}
export async function beginOwnerArchive(business:string,request:string){const {data,error}=await supabase.rpc('begin_owner_archive',{p_business:business,p_request:request});if(error)throw error;return String(data)}
export async function getOwnerArchive(business:string,archive:string|null=null,page=0):Promise<OwnerArchive|null>{
 const {data,error}=await supabase.rpc('get_owner_archive',{p_business:business,p_archive:archive,p_page:page});if(error)throw error
 if(data&&(!data.id||!['building','ready','expired'].includes(data.status)||(data.status!=='expired'&&(!Array.isArray(data.parts)||data.parts.length>25))))throw Error('The archive status could not be verified.')
 return data
}
async function archiveRequest(body:Record<string,unknown>,signal?:AbortSignal){
 const {data,error}=await supabase.auth.getSession();if(error||!data.session)throw Error('Sign in to prepare or download an archive.')
 const response=await fetch(import.meta.env.VITE_SUPABASE_URL+'/functions/v1/owner-archive',{method:'POST',signal,headers:{'Content-Type':'application/json',apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(body)})
 if(!response.ok){let message='Archive unavailable. Resume after checking your connection.';try{message=(await response.json()).error||message}catch{}throw Error(message)}
 return response
}
export async function prepareOwnerArchive(business:string,archive:string,signal?:AbortSignal){return (await archiveRequest({action:'prepare',business_id:business,archive_id:archive},signal)).json() as Promise<{ready?:boolean;busy?:boolean;prepared_part?:number}>}
export async function downloadOwnerArchive(business:string,archive:string,part:ArchivePart,signal?:AbortSignal){
 if(!part.sha256||!part.byte_size)throw Error('This archive part is not ready.')
 const response=await archiveRequest({action:'download',business_id:business,archive_id:archive,part:part.part_no},signal)
 const bytes=new Uint8Array(await response.arrayBuffer())
 if(bytes.length!==part.byte_size||await archiveHash(bytes)!==part.sha256)throw Error('The downloaded archive failed its integrity check. Download it again.')
 const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),link=document.createElement('a')
 link.href=url;link.download='Finviant-'+archive+'-part-'+part.part_no+'.zip';document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),60000)
}
