import test from 'node:test'
import assert from 'node:assert/strict'
import {authRedirect,passwordError,authMessage} from '../../src/lib/authPolicy'
test('redirects cannot follow preview origins and password policy permits passphrases',()=>{
 Object.assign(globalThis,{window:{location:{hostname:'obsolete.vercel.app',origin:'https://obsolete.vercel.app'}}})
 assert.equal(authRedirect('?recovery=1'),'https://finviant.com/?recovery=1')
 assert.equal(passwordError('a unique passphrase'),null)
 assert.ok(passwordError('x'.repeat(14)))
 assert.ok(passwordError('🔐'.repeat(25)))
 assert.match(authMessage({status:429},'reset'),/Too many/)
 assert.match(authMessage({code:'weak_password'},'signup'),/data breach/)
 assert.match(authMessage({code:'email_not_confirmed'},'signin'),/Confirm/)
 assert.doesNotMatch(authMessage({message:'internal sql error'},'reset'),/sql/)
})
