/** Accept only our structured database limit code, never arbitrary provider text. */
export function burstLimitResponse(error: unknown, headers: HeadersInit): Response | null {
 if(!error||typeof error!=='object'||!['FINVIANT_BURST_LIMIT','FINVIANT_DAILY_LIMIT'].includes(String((error as {code?:unknown}).code)))return null
 const daily=(error as {code?:unknown}).code==='FINVIANT_DAILY_LIMIT'
 const detail=(error as {details?:unknown}).details
 const retry=typeof detail==='string'&&/^\d{1,5}$/.test(detail)?Math.max(1,Math.min(daily?86400:60,Number(detail))):(daily?86400:60)
 const responseHeaders=new Headers(headers)
 responseHeaders.set('content-type','application/json')
 responseHeaders.set('cache-control','no-store')
 responseHeaders.set('retry-after',String(retry))
 responseHeaders.set('access-control-expose-headers',[responseHeaders.get('access-control-expose-headers'),'Retry-After'].filter(Boolean).join(', '))
 return new Response(JSON.stringify({error:(daily?'Daily service allowance reached. Manual work remains available. ':'Too many requests. ')+'Wait '+retry+' seconds before retrying the same operation.',code:daily?'daily_service_limit':'request_burst_limit',retry_after:retry}),{status:429,headers:responseHeaders})
}
