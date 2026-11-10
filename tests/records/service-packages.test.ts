import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {addPackage,packageLines} from '../../src/lib/servicePackages'
const line={description:'Service',quantity:'2',unit_price:'35.50',tax_rate:'5'}
test('package copies preserve quantities, partial edits and limits without mutating saved lines',()=>{
 const saved=packageLines([line]);const before=JSON.stringify(saved)
 const result=addPackage([{description:'',quantity:'1',unit_price:'',tax_rate:'0'},{...line,description:'Existing partial',unit_price:''}],saved)
 assert.equal(result.length,2);assert.equal(result[0].description,'Existing partial');assert.equal(result[1].quantity,'2')
 result[1].unit_price='1';assert.equal(JSON.stringify(saved),before)
 assert.throws(()=>addPackage(Array(50).fill(line),saved),/50-line/)
 for(const lines of [[],[{...line,quantity:'0'}],[{...line,unit_price:''}],[{...line,unit_price:'NaN'}],[{...line,tax_rate:'100.01'}],Array(51).fill(line)])assert.throws(()=>packageLines(lines))
 assert.throws(()=>addPackage([], [{description:'x',quantity:1,unit_price:'5',tax_rate:0}]),/verified/)
})
test('package validation and permissions reject forged tenant, invalid amounts and denied writes',async()=>{
 const db=new PGlite();const a='11111111-1111-4111-8111-111111111111',b='11111111-1111-4111-8111-111111111112'
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
   create table public.businesses(id uuid primary key);insert into public.businesses values('${a}'),('${b}');
   create function public.has_workspace_access(b uuid,m text) returns boolean language sql stable as $$select b::text=current_setting('fixture.business',true)$$;
   create function private.fin_access(b uuid,r text,w boolean) returns boolean language sql stable as $$select b::text=current_setting('fixture.business',true) and current_setting('fixture.write',true)='yes'$$;
   grant usage on schema private to authenticated;`)
  await db.exec(await readFile('supabase/migrations/20261110140000_reusable_service_packages.sql','utf8'))
  await db.exec(`set role authenticated;set fixture.business='${a}';set fixture.write='yes'`)
  const insert=(business:string,items:unknown,name='Service')=>db.query('insert into service_packages(business_id,name,items) values($1,$2,$3) returning id',[business,name,JSON.stringify(items)])
  await insert(a,packageLines([line]))
  await assert.rejects(insert(b,packageLines([line])),{code:'42501'})
  await assert.rejects(insert(a,packageLines([line]),' SERVICE '),{code:'23505'})
  for(const items of [[],{},Array(51).fill(packageLines([line])[0]),[{description:'bad',quantity:-1,unit_price:5,tax_rate:0}],[{description:'bad',quantity:1,unit_price:1.001,tax_rate:0}],[{description:'bad',quantity:1,unit_price:5,tax_rate:0,secret:'not allowed'}]])await assert.rejects(insert(a,items,'Invalid'),{code:'23514'})
  await assert.rejects(db.exec("update service_packages set items='[]'"),{code:'42501'})
  await db.exec("set fixture.write='no'")
  assert.equal((await db.query('select * from service_packages')).rows.length,1)
  assert.equal((await db.query('update service_packages set active=false returning id')).rows.length,0)
  await assert.rejects(insert(a,packageLines([line]),'Denied'),{code:'42501'})
  await db.exec(`set fixture.business='${b}'`);assert.equal((await db.query('select * from service_packages')).rows.length,0)
  await db.exec(`set fixture.business='${a}';set fixture.write='yes'`)
  await db.exec('update service_packages set active=false')
  await insert(a,packageLines([line]))
  await db.exec('reset role;set role anon');await assert.rejects(db.exec('select * from service_packages'),{code:'42501'})
 }finally{await db.close()}
})
