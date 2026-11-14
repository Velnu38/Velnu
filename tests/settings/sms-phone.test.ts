import {test} from 'node:test'
import assert from 'node:assert/strict'
import {normalizeMobile} from '../../src/lib/smsPhone'
test('owner mobile formatting accepts US entry and explicit international country codes without inventing ownership',()=>{
 assert.equal(normalizeMobile('(757) 555-0123'),'+17575550123');assert.equal(normalizeMobile('1 757 555 0123'),'+17575550123');assert.equal(normalizeMobile('+44 7700 900123'),'+447700900123')
 for(const p of ['','123','+0123456789','7575550123 ext 9','+17575550123;alert(1)','++17575550123','+175755501234567890','7575550123@example.com'])assert.equal(normalizeMobile(p),null,p)
})
