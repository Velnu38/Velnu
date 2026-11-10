import {spawn} from 'node:child_process'
import {chromium,expect} from '@playwright/test'
const server=spawn('node',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4178'],{env:{...process.env,VITE_SUPABASE_URL:'https://test.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'test-key'},stdio:'ignore'})
let browser
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4178/tests/billing-ui/index.html')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:390,height:844}});page.on('dialog',d=>d.accept())
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:4178/tests/billing-ui/index.html')
 await expect(page.getByText('Deposit credited: $30.00 · Open deposit invoice',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Mark Paid',exact:true}).click()
 await expect(page.getByLabel('Amount',{exact:true})).toHaveValue('75')
 await expect(page.getByLabel('Amount',{exact:true})).toHaveAttribute('readonly','')
 await page.getByRole('dialog').getByRole('button',{name:'Mark Paid',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.calls.filter(c=>c.name==='record_manual_payment').length)).toBe(1)
 await expect(page.getByRole('button',{name:'Mark Paid',exact:true})).toHaveCount(0)
 await page.reload()
 await page.getByRole('button',{name:'Record partial payment',exact:true}).click()
 await page.getByLabel('Amount',{exact:true}).fill('25')
 await page.getByRole('dialog').getByRole('button',{name:'Record partial payment',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.calls.find(c=>c.name==='record_manual_payment')?.input.payment_amount)).toBe(25)
 await page.getByRole('button',{name:'Mark Paid',exact:true}).click()
 await expect(page.getByLabel('Amount',{exact:true})).toHaveValue('50')
 await page.getByRole('dialog').getByRole('button',{name:'Mark Paid',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.calls.filter(c=>c.name==='record_manual_payment').reduce((s,c)=>s+c.input.payment_amount,0))).toBe(75)
 await page.goto('http://127.0.0.1:4178/tests/billing-ui/index.html?mode=deposit')
 await page.getByRole('button',{name:'Create deposit invoice',exact:true}).click()
 await page.getByLabel('Deposit amount',{exact:true}).fill('30')
 await page.getByRole('button',{name:'Create draft deposit invoice',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.calls[0]?.input.p_amount)).toBe(30)
 await expect(page).toHaveURL(/view=invoices&document=/)
 expect(errors).toEqual([])
 console.log('PASS: mobile full settlement, partial payment then remaining settlement, deposit creation, deposit credit display, navigation, and no browser errors')
}finally{await browser?.close();server.kill()}
