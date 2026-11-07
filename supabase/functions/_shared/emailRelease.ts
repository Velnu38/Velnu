import { resolveAppEnvironment } from './appEnvironment.ts'

export type EmailDeliveryMode = 'production' | 'private_beta' | 'disabled'

/** A beta release can never open production delivery, or an unknown project. */
export function emailDeliveryMode(get = (name: string): string | undefined => Deno.env.get(name)): EmailDeliveryMode {
  const environment = resolveAppEnvironment(get('SUPABASE_URL'), get('FINVIANT_APP_BASE_URL'))
  if (!environment || !get('RESEND_API_KEY') || !get('RESEND_WEBHOOK_SECRET')) return 'disabled'
  if (environment.name === 'staging') {
    return get('FINVIANT_PRIVATE_BETA_EMAIL_ENABLED') === 'true' ? 'private_beta' : 'disabled'
  }
  return get('FINVIANT_CUSTOMER_EMAIL_ENABLED') === 'true' ? 'production' : 'disabled'
}
