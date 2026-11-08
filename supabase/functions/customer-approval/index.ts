import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers={"Content-Type":"application/json","Cache-Control":"no-store","Referrer-Policy":"no-referrer","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
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
  if(mode==="view"){
   // The same persisted body drives the owner PDF, customer PDF, and approval.
   // Live status is separate; an expired action does not erase the document.
   const {data,error}=await supabase.rpc("get_customer_approval_document",{p_token:token});
   if(error){const m=String(error.message??"");if(m.includes("not found"))return respond(404,{error:"Approval link not found"});if(m.includes("revoked")||m.includes("unavailable"))return respond(410,{error:"Approval link is unavailable"});console.error("Approval document lookup failed",error.code);return respond(503,{error:"The document could not be loaded. Try again."});}
   return respond(200,data);
  }

  if(!['approved','declined'].includes(mode))return respond(400,{error:"Invalid approval action"});
  const typedName=String(body.typed_name??"").trim(); if(typedName.length<2||typedName.length>200)return respond(400,{error:"Enter your name to confirm your decision"});
  const termsAgreed=body.terms_agreed===true;
  const revision=body.expected_revision_id;
  if(revision!==undefined&&revision!==null&&(typeof revision!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(revision)))return respond(400,{error:"Invalid document revision"});
  const userAgent=String(req.headers.get("user-agent")??"").slice(0,500);
  const {data,error}=await supabase.rpc("consume_document_approval",{p_token_hash:tokenHash,p_action:mode,p_typed_name:typedName,p_user_agent:userAgent,p_terms_agreed:termsAgreed,...(revision?{p_expected_revision_id:revision}:{})});
  if(error){const m=String(error.message??"");if(m.includes("LINK_EXPIRED"))return respond(410,{error:"The response deadline passed. The document remains available to view."});if(m.includes("LINK_REVOKED"))return respond(410,{error:"Approval link has been revoked"});if(m.includes("LINK_NOT_FOUND"))return respond(404,{error:"Approval link not found"});if(m.includes("TERMS_NOT_ACCEPTED"))return respond(400,{error:"You must agree to the estimate terms before accepting."});if(m.includes("PRO_ACTION_REQUIRED"))return respond(403,{error:"This document is available to view and download; live approval is unavailable."});if(m.includes("DOCUMENT_SUPERSEDED")||m.includes("scope total changed")||m.includes("updated this line"))return respond(409,{error:"The document changed. Ask the business for the current version."});if(m.includes("DOCUMENT_NOT_APPROVABLE"))return respond(409,{error:"This document can no longer be approved"});console.error("Approval could not be recorded",error.code);return respond(409,{error:"Approval could not be recorded"});}
  return respond(200,data);
 }catch{console.error("Approval request failed");return respond(500,{error:"Unexpected server error"});}
});
