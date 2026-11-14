import {pathToFileURL} from 'node:url'

// Local configuration inspection only: no network, database writes, or sends.
export function inspectTwilioBeta(env) {
 const checks = {
  betaProject: env.SUPABASE_URL === 'https://xvybcmyoblfgzokaifsx.supabase.co',
  accountSid: /^AC[0-9a-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID || ''),
  authToken: /^[0-9a-f]{32}$/i.test(env.TWILIO_AUTH_TOKEN || ''),
  sender: /^\+1\d{10}$/.test(env.TWILIO_FROM_NUMBER || ''),
  approvedRecipients: !!env.FINVIANT_TEST_SMS_RECIPIENTS?.trim() &&
   env.FINVIANT_TEST_SMS_RECIPIENTS.split(',').every(v => /^\+1\d{10}$/.test(v.trim())),
  customerSendingDisabled: env.FINVIANT_CUSTOMER_SMS_ENABLED === 'false',
 }
 return {checks, configurationPrepared: Object.values(checks).every(Boolean),
  providerVerified: false, ownerPhoneVerification: 'requires separate Supabase Auth setup',
  messagesSent: 0}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const result = inspectTwilioBeta(process.env)
 // Never echo configuration values, phone numbers, tokens, or process errors.
 console.log(JSON.stringify(result, null, 2))
 if (!result.configurationPrepared) process.exitCode = 1
}
