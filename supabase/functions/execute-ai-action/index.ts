import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mutating = new Set(["create_customer","create_job","schedule_job","create_invoice","create_estimate","create_change_order","record_payment"]);
const reading = new Set(["list_unpaid_invoices","customer_history","business_summary"]);
const clean = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g," ");
Deno.serve(async(req: Request) => {
 if (req.method==="OPTIONS") return new Response("ok",{headers});
 if (req.method!=="POST") return send(405,{error:"Method not allowed"});
 try {
  const authorization=req.headers.get("Authorization")||"";
  if (!authorization.startsWith("Bearer ")) return send(401,{error:"Sign in required"});
  const url=Deno.env.get("SUPABASE_URL")||"";
  const key=Deno.env.get("SUPABASE_ANON_KEY")||
    JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}").default;
  if(!url||!key) return send(503,{error:"Service not configured"});
  const db=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:session,error:authError}=await db.auth.getUser();
  if(authError||!session.user)return send(401,{error:"Session expired"});
  const body=await req.json();
  const actionId=String(body?.action_id||"");
  if(!uuid.test(actionId))return send(400,{error:"Invalid action identifier"});
  const {data:action,error:actionError}=await db.from("ai_actions")
    .select("id,business_id,user_id,intent,parsed_payload,status,requires_confirmation")
    .eq("id",actionId).eq("user_id",session.user.id).maybeSingle();
  if(actionError)return send(500,{error:"Could not load AI action"});
  if(!action)return send(404,{error:"AI action not found"});
  if(!mutating.has(action.intent)&&!reading.has(action.intent))
    return send(422,{error:"Unsupported AI action"});
  const {data:member,error:memberError}=await db.from("business_members").select("role")
    .eq("business_id",action.business_id).eq("user_id",session.user.id).maybeSingle();
  if(memberError||!member)return send(403,{error:"No access to this business"});
  if(mutating.has(action.intent)){
    const {data,error}=await db.rpc("execute_ai_mutation",{p_action_id:actionId});
    if(error){
      console.error("Atomic AI action failed",error.code||"unknown");
      if(error.code==="42501")return send(403,{error:"You cannot perform this action"});
      if(error.code==="P0002")return send(404,{error:"Action or record not found"});
      if(["22023","23514","23503","23505"].includes(error.code||""))
        return send(409,{error:"Please review the action's customer, amount, schedule or related record. No changes were saved."});
      return send(500,{error:"Action was not completed. Retrying the same confirmed action is safe."});
    }
    return send(200,data);
  }
  if(action.status==="rejected"||action.status==="failed")
    return send(409,{error:"This AI action is no longer available"});
  const f=action.parsed_payload?.fields||{};
  let result:unknown;
  if(action.intent==="list_unpaid_invoices"){
    const {data,error}=await db.from("invoices")
      .select("id,invoice_number,status,total,amount_paid,balance_due,due_date,customers(first_name,last_name,company)")
      .eq("business_id",action.business_id).gt("balance_due",0)
      .neq("status","void").order("due_date",{ascending:true,nullsFirst:false}).limit(50);
    if(error)return send(500,{error:"Could not read outstanding invoices"});
    result={invoices:data||[],count:data?.length||0,
      total_outstanding:(data||[]).reduce((sum:number,i:any)=>sum+Number(i.balance_due||0),0)};
  }else if(action.intent==="business_summary"){
    const [customers,invoices,jobs]=await Promise.all([
      db.from("customers").select("id",{count:"exact",head:true}).eq("business_id",action.business_id).eq("archived",false),
      db.from("invoices").select("balance_due").eq("business_id",action.business_id).gt("balance_due",0).neq("status","void"),
      db.from("jobs").select("id",{count:"exact",head:true}).eq("business_id",action.business_id).neq("status","canceled")]);
    if(customers.error||invoices.error||jobs.error)return send(500,{error:"Could not calculate summary"});
    result={customers:customers.count||0,open_invoices:invoices.data?.length||0,
      active_jobs:jobs.count||0,
      outstanding:(invoices.data||[]).reduce((sum:number,i:any)=>sum+Number(i.balance_due||0),0)};
  }else{
    const requested=clean(f.customer_name||f.company_name);
    if(!requested)return send(409,{error:"Specify a customer"});
    const {data:candidates,error:lookupError}=await db.from("customers")
      .select("id,first_name,last_name,company").eq("business_id",action.business_id)
      .eq("archived",false).limit(200);
    if(lookupError)return send(500,{error:"Customer lookup failed"});
    const matches=(candidates||[]).filter((c:any)=>clean([c.first_name,c.last_name].filter(Boolean).join(" "))===requested||clean(c.company)===requested);
    if(matches.length!==1)return send(409,{error:matches.length?"Customer name is ambiguous":"Customer not found"});
    const customer=matches[0];
    const [jobs,invoices]=await Promise.all([
      db.from("jobs").select("id,title,status,scheduled_start,completed_at")
        .eq("business_id",action.business_id).eq("customer_id",customer.id).order("created_at",{ascending:false}).limit(20),
      db.from("invoices").select("id,invoice_number,status,total,amount_paid,balance_due,issue_date,due_date")
        .eq("business_id",action.business_id).eq("customer_id",customer.id).order("created_at",{ascending:false}).limit(20)]);
    if(jobs.error||invoices.error)return send(500,{error:"Customer history lookup failed"});
    result={customer,jobs:jobs.data||[],invoices:invoices.data||[]};
  }
  return send(200,{action_id:actionId,status:"read",result});
 }catch{return send(500,{error:"Could not process AI action"})}
});
