import test from 'node:test'
import assert from 'node:assert/strict'
import {validateReply,validateLookup,recordHref} from '../../supabase/functions/fin-workflow/protocol'
import {accountCatalog} from '../../supabase/functions/fin-workflow/catalog'
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const set=(resource:string,fields:any={})=>({resource:resource as any,rows:[{id,_version:'version-1',...fields}],matching_count:1,offset:0,complete:true});
const reply=(resource:string,changes:any[],operation='update_account_record')=>({answer:'Review these changes.',source_keys:[],navigation:[],clarification:null,steps:[{operation,target:resource+':'+id,customer:null,fields:{resource,changes}}]});
test('account catalog has verified destinations and excludes credentials, tokens and privileged administration',()=>{
 assert.equal(Object.keys(accountCatalog.resources).length,25);for(const resource of Object.values(accountCatalog.resources)){assert.ok(accountCatalog.views[resource.view as keyof typeof accountCatalog.views]);assert.ok(resource.read_fields.every(f=>!/token|credential|password|storage_path/.test(f)));}
 assert.equal(recordHref('business_profile:'+id),'/?view=settings&section=company');assert.equal(recordHref('worker_time_off:'+id),'/?view=settings&section=scheduling');assert.equal(validateLookup({resource:'auth.users'}),false);
});
test('only verified records and allowlisted typed fields can be edited, and before values/version are preserved',()=>{
 const data=[set('customers',{email:'before@example.test'})];const p=validateReply(reply('customers',[{field:'email',value:'after@example.test'}]),data,['Set email to after@example.test']);assert.equal(p.steps[0].expected,'version-1');assert.equal(p.steps[0].record?.email,'before@example.test');assert.equal((p.steps[0].fields.values as any).email,'after@example.test');
 for(const changes of [[{field:'business_id',value:other}],[{field:'email',value:'bad'}],[{field:'archived',value:null}],[{field:'phone',value:'one'},{field:'phone',value:'two'}]])assert.throws(()=>validateReply(reply('customers',changes),data));
 assert.throws(()=>validateReply(reply('customers',[{field:'notes',value:'edit'}]),[]),/Read the exact/);
});
test('references must come from a same-turn account lookup; money cannot be invented',()=>{
 const data=[set('jobs',{title:'Mow'})];assert.throws(()=>validateReply(reply('jobs',[{field:'property_id',value:'properties:'+other}]),data),/referenced/);
 const references=[...data,{...set('properties'),rows:[{id:other,_version:'property-v1'}]}];const p=validateReply(reply('jobs',[{field:'property_id',value:'properties:'+other}]),references);assert.equal((p.steps[0].fields.values as any).property_id,other);assert.ok((p.steps[0] as any).related.property_id.record._version);
 assert.throws(()=>validateReply(reply('bookkeeping_entries',[{field:'amount',value:'200'}]),[set('bookkeeping_entries')],['Change amount']),/amount/);assert.equal((validateReply(reply('bookkeeping_entries',[{field:'amount',value:'200'}]),[set('bookkeeping_entries')],['Change amount to $200']).steps[0].fields.values as any).amount,200);
});
test('calendar, URLs, tax, time zones and line items reject invalid or unsupported values',()=>{
 for(const [resource,field,value] of [['business_profile','website','https://user:password@example.test'],['business_profile','timezone','Mars/Space'],['document_settings','default_tax_rate','101'],['invoices','issue_date','2026-02-30'],['appointments','starts_at','2026-11-04T12:00:00']])assert.throws(()=>validateReply(reply(resource,[{field,value}]),[set(resource)]));
 const items=[{description:'Mow',quantity:2,unit_price:100,tax_rate:0}];assert.throws(()=>validateReply(reply('change_orders',[{field:'items',value:JSON.stringify(items)}]),[set('change_orders')],['Mow $100']),/quantity/);assert.equal(validateReply(reply('change_orders',[{field:'items',value:JSON.stringify(items)}]),[set('change_orders')],['2 visits at $100']).steps[0].total,'200.00');
});
test('deployed SQL and TypeScript use the same field and navigation catalog',async()=>{const {readFile}=await import('node:fs/promises');const sql=await readFile('supabase/migrations/20261104213955_fin_support_reporter_scope.sql','utf8');assert.deepEqual(JSON.parse(sql.match(/\$json\$([\s\S]*?)\$json\$/)![1]),accountCatalog)})
