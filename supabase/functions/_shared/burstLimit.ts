/** Accept only our structured database limit code, never arbitrary provider text. */
export function burstLimitResponse(error: unknown, headers: HeadersInit): Response | null {
 if(!error||typeof error!=='object'||(error as {code?:unknown}).code!=='FINVIANT_BURST_LIMIT')return null
 const detail=(error as {details?:unknown}).details
 const retry=typeof detail==='string'&&/^\d{1,3}$/.test(detail)?Math.max(1,Math.min(60,Number(detail))):60
 const responseHeaders=new Headers(headers)
 responseHeaders.set('content-type','application/json')
 responseHeaders.set('cache-control','no-store')
 responseHeaders.set('retry-after',String(retry))
 responseHeaders.set('access-control-expose-headers',[responseHeaders.get('access-control-expose-headers'),'Retry-After'].filter(Boolean).join(', '))
 return new Response(JSON.stringify({error:'Too many requests. Wait '+retry+' seconds before trying again. Your saved records are unchanged.',code:'request_burst_limit',retry_after:retry}),{status:429,headers:responseHeaders})
}
