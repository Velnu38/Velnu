import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers={"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const respond=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return respond(405,{error:"Method not allowed"});
 try{
  const authHeader=req.headers.get("Authorization");if(!authHeader)return respond(401,{error:"Unauthorized"});
  const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:authHeader}}});
  const {data:identity,error:authError}=await supabase.auth.getUser();if(authError||!identity.user)return respond(401,{error:"Unauthorized"});
  const body=await req.json(),business=String(body.business_id??""),kind=String(body.document_type??""),document=String(body.document_id??"");
  if(!business||!document||!['estimate','change_order'].includes(kind))return respond(400,{error:"business_id, document_type and document_id are required"});
  // The RPC publishes the saved version and atomically reuses its existing link.
  // expires_days from older clients is intentionally ignored: estimates follow
  // their displayed Valid Until date and change orders use their action deadline.
  const {data,error}=await supabase.rpc("issue_document_approval_link",{p_business:business,p_kind:kind,p_document:document,p_rotate:body.rotate===true});
  if(error){const message=String(error.message??"");if(error.code==="42501")return respond(403,{error:message||"Document access denied"});if(error.code==="23514"||error.code==="23505")return respond(409,{error:message});console.error("Approval link could not be prepared",error.code);return respond(503,{error:"The approval link could not be prepared. Try again."});}
  return respond(200,data);
 }catch{ return respond(400,{error:"Invalid approval link request"}); }
});
