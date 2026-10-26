import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers={"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const respond=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers});
function toBase64Url(bytes:Uint8Array){let binary="";for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
async function hashToken(token:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));return Array.from(new Uint8Array(digest)).map((b)=>b.toString(16).padStart(2,"0")).join("");}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return respond(405,{error:"Method not allowed"});
 try{
  const authHeader=req.headers.get("Authorization"); if(!authHeader)return respond(401,{error:"Unauthorized"});
  const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:authHeader}}});
  const {data:userData,error:userError}=await supabase.auth.getUser(); if(userError||!userData.user)return respond(401,{error:"Unauthorized"});
  const body=await req.json(); const businessId=String(body.business_id??""); const documentType=String(body.document_type??""); const documentId=String(body.document_id??"");
  let expiresDays=Number(body.expires_days??14); if(!Number.isInteger(expiresDays)||expiresDays<1||expiresDays>30)expiresDays=14;
  if(!businessId||!documentId||!['estimate','change_order'].includes(documentType))return respond(400,{error:"business_id, document_type and document_id are required"});
  const {data:membership}=await supabase.from("business_members").select("role").eq("business_id",businessId).eq("user_id",userData.user.id).maybeSingle();
  if(!membership)return respond(403,{error:"Forbidden"}); if(membership.role==="viewer")return respond(403,{error:"Viewer role is read-only"});

  if(documentType==="estimate"){
   const {data:doc,error}=await supabase.from("estimates").select("id,status").eq("id",documentId).eq("business_id",businessId).maybeSingle();
   if(error)return respond(500,{error:"Failed to validate estimate"}); if(!doc)return respond(404,{error:"Estimate not found"}); if(doc.status!=="sent")return respond(409,{error:"Mark this estimate as sent before generating a customer approval link."});
   await supabase.from("document_approval_links").update({revoked_at:new Date().toISOString()}).eq("business_id",businessId).eq("estimate_id",documentId).is("revoked_at",null);
  }else{
   const {data:doc,error}=await supabase.from("change_orders").select("id,status").eq("id",documentId).eq("business_id",businessId).maybeSingle();
   if(error)return respond(500,{error:"Failed to validate change order"}); if(!doc)return respond(404,{error:"Change order not found"}); if(doc.status!=="sent")return respond(409,{error:"Mark this change order as sent before generating a customer approval link."});
   await supabase.from("document_approval_links").update({revoked_at:new Date().toISOString()}).eq("business_id",businessId).eq("change_order_id",documentId).is("revoked_at",null);
  }

  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);const token=toBase64Url(bytes);const tokenHash=await hashToken(token);const expiresAt=new Date(Date.now()+expiresDays*86400000).toISOString();
  const row:any={business_id:businessId,document_type:documentType,token_hash:tokenHash,expires_at:expiresAt,created_by_user_id:userData.user.id};
  if(documentType==="estimate")row.estimate_id=documentId;else row.change_order_id=documentId;
  const {data:link,error:insertError}=await supabase.from("document_approval_links").insert(row).select("id,expires_at").single();
  if(insertError){console.error(insertError);return respond(500,{error:"Failed to create approval link"});}
  return respond(200,{approval_link_id:link.id,token,expires_at:link.expires_at,relative_url:`/?approval=${encodeURIComponent(token)}`});
 }catch(error){console.error(error);return respond(500,{error:"Unexpected server error"});}
});