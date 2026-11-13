/** Advanced regressions enter the simplified form's retained tools explicitly. */
export async function openInvoiceOptions(target){
 const summary=target.locator('.invoice-more-options>summary')
 await summary.waitFor({state:'visible'})
 if(!await summary.evaluate(el=>el.parentElement.open))await summary.click()
}
export async function reviewDocument(target){
 await target.getByRole('button',{name:/^(Preview|Review invoice)$/,exact:true}).click()
 const pdf=target.locator('.invoice-pdf-export>summary')
 if(await pdf.count()){const other=target.getByRole('button',{name:/^(Other delivery options|Contact & delivery options)$/});if(await other.count())await other.click();await pdf.click();const send=target.getByRole('button',{name:/^(Send Finviant Email|Open email app|Contact & delivery options)$/});if(await send.count())await send.first().scrollIntoViewIfNeeded()}
}
export async function addDocumentItem(target){
 const compact=target.getByRole('button',{name:'+ Add item',exact:true})
 if(await compact.count()){await compact.click();await target.getByRole('button',{name:'Enter an item manually',exact:true}).click()}
 else await target.getByRole('button',{name:'+ Add line',exact:true}).click()
}
