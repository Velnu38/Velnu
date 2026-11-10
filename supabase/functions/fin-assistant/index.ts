import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import {sumMoney} from './core.ts'
import {providerJson} from '../_shared/providerRequest.ts'
import {finHandler,type FinContext} from './handler.ts'
const env=(name:string)=>Deno.env.get(name)||''
const clip=(value:unknown,max=1000)=>typeof value==='string'?value.slice(0,max):value
Deno.serve(finHandler({
 configured:()=>!!env('OPENAI_API_KEY'),
 async authorize(authorization,businessId){
  const key=env('SUPABASE_ANON_KEY')||JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS')||'{}').default
  const db=createClient(env('SUPABASE_URL'),key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
  const {data:auth,error}=await db.auth.getUser();if(error||!auth.user)return null
  const {data:member,error:membershipError}=await db.from('business_members').select('role').eq('business_id',businessId).eq('user_id',auth.user.id).maybeSingle()
  if(membershipError||!member)return null
  return {
   role:member.role,
   async entitled(){const {data,error}=await db.rpc('get_plan_usage',{target_business_id:businessId});if(error)throw error;return Number(data?.ai_limit)>0},
   async reserve(){const {error}=await db.rpc('reserve_ai_request',{p_business:businessId,p_request:crypto.randomUUID(),p_feature:'ai',p_units:1});if(error)throw error},
   async context(mode):Promise<FinContext>{
    const {data:profile,error}=await db.from('businesses').select('name,timezone,business_description,services_offered,service_area,team_size,team_roles').eq('id',businessId).single();if(error)throw error
    const context:FinContext={profile,as_of:new Date().toISOString(),timezone:profile.timezone||'America/New_York',sources:[{key:'profile',label:'Saved company profile'}],limits:[]}
    if(mode==='draft')return context
    const from=new Date(Date.now()-86400000).toISOString(),to=new Date(Date.now()+31*86400000).toISOString()
    // The caller JWT is used for every read. No service-role client, arbitrary
    // SQL, model-selected tables or client-provided context can reach Fin.
    const queries=[
     {name:'customers',query:db.from('customers').select('id,first_name,last_name,company',{count:'exact'}).eq('business_id',businessId).eq('archived',false).order('created_at',{ascending:false}).order('id').limit(50)},
     {name:'unpaid_invoices',query:db.from('invoices').select('id,invoice_number,customer_id,status,balance_due,due_date,issue_date',{count:'exact'}).eq('business_id',businessId).gt('balance_due',0).neq('status','void').order('due_date',{ascending:true,nullsFirst:false}).order('id').limit(50)},
     {name:'estimates',query:db.from('estimates').select('id,estimate_number,customer_id,status,total,issue_date',{count:'exact'}).eq('business_id',businessId).order('created_at',{ascending:false}).order('id').limit(50)},
     {name:'jobs',query:db.from('jobs').select('id,title,description,customer_id,status,scheduled_start,scheduled_end',{count:'exact'}).eq('business_id',businessId).not('status','in','(completed,canceled)').order('scheduled_start',{ascending:true,nullsFirst:false}).order('id').limit(50)},
     {name:'schedule',query:db.from('calendar_work').select('source_key,title,description,starts_at,ends_at,status',{count:'exact'}).eq('business_id',businessId).lt('starts_at',to).or(`ends_at.gt.${from},and(ends_at.is.null,starts_at.gte.${from})`).order('starts_at').order('source_key').limit(50)},
     {name:'reminders',query:db.from('reminders').select('id,note,due_at,status',{count:'exact'}).eq('business_id',businessId).eq('status','pending').lt('due_at',to).order('due_at').order('id').limit(50)}
    ]
    const results=await Promise.all(queries.map(async({name,query})=>({name,...await query})))
    const records:Record<string,unknown>={}
    for(const result of results){
     if(result.error)throw result.error
     const rows=(result.data||[]).map((row:Record<string,unknown>)=>{
      const key=result.name+':'+(row.id||row.source_key)
      const label=String(row.invoice_number||row.estimate_number||row.title||row.note||[row.first_name,row.last_name].filter(Boolean).join(' ')||row.company||result.name).slice(0,160)
      context.sources.push({key,label:result.name.replaceAll('_',' ')+' · '+label})
      return Object.fromEntries(Object.entries({...row,source_key:key}).map(([k,v])=>[k,clip(v,k==='description'?1500:500)]))
     })
     records[result.name]={rows,matching_count:result.count,shown:rows.length}
     context.limits.push(`${result.name}: ${rows.length} of ${result.count??'unknown'} matching records shown${(result.count??0)>rows.length?' — partial results':''}.`)
    }
    context.limits.push('Scope: latest 50 active customers and estimates, first 50 unpaid invoices (including labeled drafts), active jobs, pending reminders, and Finviant schedule overlapping yesterday through the next 31 days. Paid invoice history, bank accounts, external email and external calendar events are not included. Draft invoices are not issued debts.')
    const unpaid=results.find(r=>r.name==='unpaid_invoices')?.data||[]
    records.retrieved_invoice_sums={issued_outstanding:sumMoney(unpaid.filter((r:any)=>r.status!=='draft'),'balance_due'),draft_balances:sumMoney(unpaid.filter((r:any)=>r.status==='draft'),'balance_due'),scope:'Only the unpaid invoices shown above. Draft balances are not issued debts; exclude them when describing money owed. These are not whole-account totals if records were truncated.'}
    context.records=records
    return context
   }
  }
 },
 async complete(instructions,input,schema){
  return await providerJson('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+env('OPENAI_API_KEY'),'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-6-luna',reasoning:{effort:'low'},instructions,input,store:false,max_output_tokens:3500,text:{format:{type:'json_schema',name:'fin_response',strict:true,schema}}})},{timeoutMs:45000,maxBytes:1048576})
 }
}))
