import {test} from 'node:test'
import assert from 'node:assert/strict'
import {taskHelpText} from '../../src/lib/assistantEntry'
test('task help carries unsaved context and explicitly withholds mutation permission',()=>{
 const text=taskHelpText('Create a job',[{label:'Title',value:'Mulch installation'},{label:'Customer',value:'Test Customer'}])
 assert.match(text,/Create a job/);assert.match(text,/Mulch installation/);assert.match(text,/Test Customer/);assert.match(text,/not permission to save, create, send, delete, or change any record/)
})
test('passwords, hidden IDs, files and credentials never enter the handoff',()=>{
 const text=taskHelpText('Edit settings',[{label:'Password',value:'never-show-1',type:'password'},{label:'Record',value:'never-show-2',type:'hidden'},{label:'API key',value:'never-show-3'},{label:'Access token',value:'never-show-4'},{label:'Attachment',value:'never-show-5',type:'file'}])
 assert.doesNotMatch(text,/never-show/)
})
test('oversized drafts fit existing assistant entry limit',()=>{
 assert.ok(taskHelpText('x'.repeat(500),Array.from({length:50},()=>({label:'Description',value:'x'.repeat(4000)}))).length<=2000)
})
test('empty forms request missing information without inventing values',()=>{
 assert.match(taskHelpText('Add a customer',[]),/not entered details yet/)
})
