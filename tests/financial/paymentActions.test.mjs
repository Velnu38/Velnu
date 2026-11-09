import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
// Assert the rendered workflow, including partial/full settlement and retry,
// rather than matching a literal button in the former pre-policy component.
test('invoice payment actions preserve full/partial settlement, retries and protected states',()=>{
 const result=spawnSync(process.execPath,['tests/settings/invoice-detail-actions-dom.mjs'],{encoding:'utf8',timeout:45000})
 assert.equal(result.status,0,(result.stdout||'')+(result.stderr||''))
 assert.match(result.stdout,/PASS invoice states/)
})
