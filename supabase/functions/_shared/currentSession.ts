/** Use a caller-scoped client, never a service client. The database verifies the
 * JWT subject/session against auth.sessions; getUser alone does not revoke JWTs.
 */
export async function currentSessionActor(client: {
 auth: { getUser: () => PromiseLike<{data: {user: {id: string} | null}; error: unknown}> }
 rpc: (name: string) => { abortSignal: (signal: AbortSignal) => PromiseLike<{data: unknown; error: unknown}> }
}): Promise<string | null> {
 try {
  const identity=await client.auth.getUser()
  if(identity.error || !identity.data.user) return null
  const {data,error}=await client.rpc('current_session_actor').abortSignal(AbortSignal.timeout(8000))
  return !error && data===identity.data.user.id && typeof data==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data) ? data : null
 } catch { return null }
}
