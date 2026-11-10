import test from 'node:test'
import assert from 'node:assert/strict'
import {invoicePaymentUrl,paymentProviderName,paymentProviders,safePaymentLinks} from '../../src/lib/paymentLinks'

test('new payment choices stay Stripe/Square while issued instructions retain legacy labels and safe links',()=>{
 assert.deepEqual(paymentProviders.map(p=>p.id),['stripe','square'])
 const links=[{provider:'venmo',url:'https://venmo.com/business'},{provider:'paypal',url:'https://paypal.me/business'},{provider:'cashapp',url:'https://cash.app/$Business'}]
 assert.deepEqual(safePaymentLinks(links),links)
 assert.deepEqual(links.map(link=>paymentProviderName(link.provider)),['Venmo','PayPal','Cash App'])
 assert.equal(invoicePaymentUrl(links[1],100,'INV-920','USD'),'https://paypal.me/business/100.00USD')
 assert.equal(safePaymentLinks([{provider:'paypal',url:'https://unrelated.example/pay'}]).length,0)
})
