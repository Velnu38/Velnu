type Db={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:any;error:any}>;storage:{from:(bucket:string)=>{remove:(paths:string[])=>PromiseLike<{error:any}>}}}
/** Delete generated expired copies only. Original buckets and business rows are never touched. */
export async function cleanupOwnerArchives(db:Db){
 const {data,error}=await db.rpc('expired_owner_archive_parts');if(error||!Array.isArray(data)||data.length>100)throw Error('Archive cleanup unavailable')
 if(!data.length){const result=await db.rpc('remove_expired_owner_archive_parts',{p_parts:[]});if(result.error)throw Error('Archive cleanup unconfirmed');return 0}
 for(const row of data)if(!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[1-9][0-9]*\.zip$/.test(row.path)||!row.path.includes('/'+row.archive_id+'/')||!row.path.endsWith('/'+row.part_no+'.zip'))throw Error('Invalid archive cleanup path')
 const removed=await db.storage.from('finviant-owner-archives').remove(data.map(row=>row.path));if(removed.error)throw Error('Archive cleanup unconfirmed')
 const finished=await db.rpc('remove_expired_owner_archive_parts',{p_parts:data.map(({archive_id,part_no}:any)=>({archive_id,part_no}))});if(finished.error)throw Error('Archive cleanup unconfirmed')
 return data.length
}
