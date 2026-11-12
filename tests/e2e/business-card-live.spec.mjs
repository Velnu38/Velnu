import {test,expect} from '@playwright/test';
const id='88888888-8888-4888-8888-888888888888';
const url='https://finviant.com/?business_card='+id;
for(const width of [320,390,430])test(`live card contacts, request retry and unpublished recovery at ${width}px @native-handoff`,async({page})=>{
 await page.setViewportSize({width,height:844});let available=true,requests=[],downloads=0;
 const card={card:{name:'Renée Services',phone:'+17575550123',email:'hello@example.test',website:'https://example.test',tagline:'Repairs',include_address:false},branding:{accent:'#195246',logo_path:null},vcard:`BEGIN:VCARD\r\nVERSION:3.0\r\nURL:${url}\r\nFN:Renée Services\r\nEMAIL:hello@example.test\r\nEND:VCARD\r\n`,filename:'E-Business-Card.vcf',url,expires_at:null};
 await page.route('https://example.supabase.co/**',async route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1),body=route.request().postDataJSON();
  let data;
  if(name==='get_live_business_card'){expect(body).toEqual({p_public_id:id});data=available?card:null;}
  else if(name==='request_business_card_estimate'){requests.push(body);if(requests.length===1)return route.fulfill({status:503,json:{message:'Synthetic lost response. Retry the same request.'}});data={received:true};}
  else throw Error('Unexpected network request '+name);
  await route.fulfill({json:data});
 });
 await page.goto('/?business_card='+id);await expect(page.getByRole('heading',{name:'Renée Services'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Call Business'})).toHaveAttribute('href','tel:+17575550123');await expect(page.getByRole('link',{name:'Text Business'})).toHaveAttribute('href','sms:+17575550123');await expect(page.getByRole('link',{name:'Email Business'})).toHaveAttribute('href','mailto:hello@example.test');
 await expect(page.getByRole('button',{name:'Share Card',exact:true})).toBeEnabled();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save to Contacts'}).click();expect((await download).suggestedFilename()).toBe(card.filename);downloads++;
 await page.getByRole('button',{name:'Request an Estimate'}).click();await page.getByLabel('Your name').fill('Customer');await page.getByLabel('Your email').fill('customer@example.test');await page.getByLabel('What do you need?').fill('Repair estimate');
 await page.getByRole('button',{name:'Submit estimate request'}).click();await expect(page.getByRole('status')).toContainText('Synthetic lost response');await page.getByRole('button',{name:'Submit estimate request'}).click();await expect(page.getByRole('status')).toContainText('Request received for business review');expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);expect(downloads).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/business-card-live-${width}.png`,fullPage:true});
 available=false;await page.reload();await expect(page.getByRole('heading',{name:'This card link is unavailable'})).toBeVisible();await expect(page.getByRole('button',{name:'Save to Contacts'})).toHaveCount(0);
});
