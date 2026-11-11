export type JobsWorkspace = 'jobs' | 'management'
export function jobsPreferenceKey(user:string,business:string){return `finviant-jobs-workspace:v1:${user}:${business}`}
export function preferredJobsWorkspace(search:string,saved:string|null):JobsWorkspace {
  const query=new URLSearchParams(search)
  if(query.get('workspace')==='management')return 'management'
  if(['workspace','document','job','new','customer','schedule'].some(key=>query.has(key)))return 'jobs'
  return saved==='management'?'management':'jobs'
}
