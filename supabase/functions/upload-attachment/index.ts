import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { resolveAppEnvironment } from '../_shared/appEnvironment.ts'
import { attachmentHandler } from './handler.ts'
const url = Deno.env.get('SUPABASE_URL')!
const environment = resolveAppEnvironment(url)
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
Deno.serve(environment ? attachmentHandler({
  origins: environment.origins,
  async authorize(header) {
    if (!header.startsWith('Bearer ')) return null
    const { data, error } = await admin.auth.getUser(header.slice(7))
    return error ? null : data.user?.id || null
  },
  reserve: async (actor, bucket, path, bytes) => await admin.rpc('reserve_attachment', { p_actor: actor, p_bucket: bucket, p_path: path, p_bytes: bytes }),
  upload: async (bucket, path, bytes, type) => await admin.storage.from(bucket).upload(path, bytes, { contentType: type, upsert: false, cacheControl: '3600' }),
  finish: async (bucket, path) => await admin.rpc('finish_attachment', { p_bucket: bucket, p_path: path }),
}) : () => new Response('Environment is not configured', { status: 503 }))
