import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers={"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const respond=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers});
async function hashToken(token:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));return Array.from(new Uint8Array(digest)).map((b)=>b.toString(16).padStart(2,"0")).join("");}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return respond(405,{error:"Method not allowed"});
 try{
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if(!serviceKey)return respond(503,{error:"Approval service is not configured"});
  const supabase=createClient(Deno.env.get("SUPABASE_URL")!,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const body=await req.json(); const token=String(body.token??"").trim(); const mode=String(body.mode??"view");
  if(token.length<32||token.length>200)return respond(400,{error:"Invalid approval token"});
  const tokenHash=await hashToken(token);
  const {data:link,error:linkError}=await supabase.from("document_approval_links").select("id,business_id,document_type,estimate_id,change_order_id,expires_at,revoked_at").eq("token_hash",tokenHash).maybeSingle();
  if(linkError){console.error(linkError);return respond(500,{error:"Approval link lookup failed"});} if(!link)return respond(404,{error:"Approval link not found"});
  const {data:existing}=await supabase.from("document_approvals").select("id,action,typed_name,amount_at_action,created_at,document_snapshot").eq("approval_link_id",link.id).maybeSingle();

  if(mode==="view"){
   if(!existing){if(link.revoked_at)return respond(410,{error:"Approval link has been revoked"});if(new Date(link.expires_at).getTime()<=Date.now())return respond(410,{error:"Approval link has expired"});}
   const {data:business}=await supabase.from("businesses").select("name,legal_name,email,phone,website,address_line1,address_line2,city,state,postal_code,logo_path,document_accent,document_footer").eq("id",link.business_id).single();
   let document:any=null; let items:any[]=[]; let customer:any=null;
   if(link.document_type==="estimate"){
    const {data:doc,error}=await supabase.from("estimates").select("id,estimate_number,status,issue_date,expires_on,subtotal,tax_amount,total,customer_message,customer_id").eq("id",link.estimate_id).eq("business_id",link.business_id).single(); if(error)return respond(404,{error:"Estimate not found"}); document=doc;
    const {data:itemRows}=await supabase.from("estimate_items").select("description,quantity,unit_price,tax_rate,line_total,sort_order").eq("estimate_id",doc.id).order("sort_order",{ascending:true});items=itemRows??[];
    const {data:c}=await supabase.from("customers").select("first_name,last_name,company").eq("id",doc.customer_id).eq("business_id",link.business_id).single();customer=c;
   }else{
    const {data:doc,error}=await supabase.from("change_orders").select("id,change_order_number,status,title,description,reason,schedule_impact_days,schedule_note,issue_date,subtotal,tax_amount,total,customer_message,customer_id,job_id").eq("id",link.change_order_id).eq("business_id",link.business_id).single(); if(error)return respond(404,{error:"Change order not found"}); document=doc;
    const {data:itemRows}=await supabase.from("change_order_items").select("description,quantity,unit_price,tax_rate,line_total,sort_order").eq("change_order_id",doc.id).order("sort_order",{ascending:true});items=itemRows??[];
    const {data:c}=await supabase.from("customers").select("first_name,last_name,company").eq("id",doc.customer_id).eq("business_id",link.business_id).single();customer=c;
    const {data:j}=await supabase.from("jobs").select("title").eq("id",doc.job_id).eq("business_id",link.business_id).single();document.job_title=j?.title??null;
   }
   return respond(200,{business_name:business?.name??"Business",business_profile:business??null,document_type:link.document_type,document,items,customer,expires_at:link.expires_at,completed:existing?{action:existing.action,typed_name:existing.typed_name,amount:existing.amount_at_action,created_at:existing.created_at,terms_agreed:existing.document_snapshot?.terms_accepted===true}:null});
  }

  if(!['approved','declined'].includes(mode))return respond(400,{error:"Invalid approval action"});
  const typedName=String(body.typed_name??"").trim(); if(typedName.length<2||typedName.length>200)return respond(400,{error:"Enter your name to confirm your decision"});
  const termsAgreed=body.terms_agreed===true;
  if(link.document_type==="estimate"&&mode==="approved"&&!termsAgreed)return respond(400,{error:"You must agree to the estimate terms before accepting."});
  const userAgent=String(req.headers.get("user-agent")??"").slice(0,500);
  const {data,error}=await supabase.rpc("consume_document_approval",{p_token_hash:tokenHash,p_action:mode,p_typed_name:typedName,p_user_agent:userAgent,p_terms_agreed:termsAgreed});
  if(error){console.error(error);const m=String(error.message??"");if(m.includes("LINK_EXPIRED"))return respond(410,{error:"Approval link has expired"});if(m.includes("LINK_REVOKED"))return respond(410,{error:"Approval link has been revoked"});if(m.includes("LINK_NOT_FOUND"))return respond(404,{error:"Approval link not found"});if(m.includes("TERMS_NOT_ACCEPTED"))return respond(400,{error:"You must agree to the estimate terms before accepting."});if(m.includes("DOCUMENT_NOT_APPROVABLE"))return respond(409,{error:"This document can no longer be approved"});return respond(409,{error:"Approval could not be recorded"});}
  return respond(200,data);
 }catch(error){console.error(error);return respond(500,{error:"Unexpected server error"});}
});