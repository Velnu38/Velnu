import test from 'node:test'
import assert from 'node:assert/strict'
import {inspectTwilioBeta} from '../../scripts/check-twilio-beta.mjs'
const fixture = {SUPABASE_URL:'https://xvybcmyoblfgzokaifsx.supabase.co',TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'b'.repeat(32),TWILIO_FROM_NUMBER:'+17575550100',FINVIANT_TEST_SMS_RECIPIENTS:'+17575550101',FINVIANT_CUSTOMER_SMS_ENABLED:'false'}
test('preflight never certifies provider delivery or prints configuration values',()=>{
 const result=inspectTwilioBeta(fixture)
 assert.equal(result.configurationPrepared,true)
 assert.equal(result.providerVerified,false)
 assert.equal(result.messagesSent,0)
 for(const key of ['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM_NUMBER','FINVIANT_TEST_SMS_RECIPIENTS']) assert.ok(!JSON.stringify(result).includes(fixture[key]))
})
test('missing configuration, other projects, unsafe recipients and enabled sends fail preparation',()=>{
 assert.equal(inspectTwilioBeta({}).configurationPrepared,false)
 for(const [key,value] of [['SUPABASE_URL','https://qusmeexjbwphoezlcmie.supabase.co'],['FINVIANT_CUSTOMER_SMS_ENABLED','true'],['FINVIANT_TEST_SMS_RECIPIENTS','+17575550101,invalid'],['TWILIO_AUTH_TOKEN','placeholder']]) assert.equal(inspectTwilioBeta({...fixture,[key]:value}).configurationPrepared,false)
})
