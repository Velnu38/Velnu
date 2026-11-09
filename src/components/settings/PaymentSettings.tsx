import SquareConnection from './SquareConnection'
import './settings.css'
import {useUnsavedChanges} from '../../lib/unsavedChanges'
import { useEffect, useState, type FormEvent } from "react";
import type { CurrentBusiness } from "../../lib/business";
import {
  emptyDocumentSettings,
  getDocumentSettings,
  savePaymentSettings,
  type PaymentSettings as Defaults,
} from "../../services/settings";
import { paymentProviders, validPaymentLink } from "../../lib/paymentLinks";

export default function PaymentSettings({ business, onSaved, submitLabel="Save payment options" }: { business: CurrentBusiness; onSaved?:()=>void; submitLabel?:string }) {
  const [value, setValue] = useState<Defaults>(emptyDocumentSettings);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void getDocumentSettings(business.id).then((settings) => {
      if (active) { setValue(settings); setLoaded(true); }
    }).catch((e) => {
      if (active) setError(e.message || "Unable to load payment options.");
    });
    return () => { active = false; };
  }, [business.id]);

  const guard=useUnsavedChanges(busy)
  const setups=value.payment_service_setups??value.payment_links.map(link=>({...link,include_by_default:true}))
  function setSetup(provider:string,url:string,include:boolean){const next=[...setups.filter(s=>s.provider!==provider),{provider:provider as typeof value.payment_links[number]['provider'],url,include_by_default:include}];setValue({...value,payment_service_setups:next,payment_links:next.filter(s=>s.include_by_default).map(({provider,url})=>({provider,url}))})}
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !loaded) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (setups.some((link) => !validPaymentLink(link))) {
        throw new Error("Use a valid HTTPS payment link from the selected provider.");
      }
      // Save payment fields only; document tax defaults are managed separately.
      await savePaymentSettings(business.id, {...value,payment_service_setups:setups});guard.markClean();
      setNotice("Payment options saved. New invoices use the selected defaults; existing invoices keep their saved payment details.");
      onSaved?.();
    } catch (e) {
      setError((e as Error).message || "Unable to save payment options.");
    } finally { setBusy(false); }
  }
  if (!loaded) return error ? <p role="alert">{error} <button className="text-button" onClick={() => window.location.reload()}>Reload settings</button></p> : <p role="status">Loading payment options…</p>;
  return (
    <form className="settings-panel" onSubmit={submit} onInputCapture={e=>{if(!(e.target as Element).closest('[data-payment-independent]'))guard.markDirty()}} onChangeCapture={e=>{if(!(e.target as Element).closest('[data-payment-independent]'))guard.markDirty()}}>
      <p className="quiet">Choose how customers can pay your business. Only the primary Finviant account owner can manage these payment options.</p>
      <section className="settings-inset">
        <h3>Stripe &amp; Square payment links</h3>
        <p className="quiet">
          Use links from your own business payment accounts. Buttons appear on
          invoices only. Payments and provider fees are handled directly between
          you and the provider, outside Finviant.
        </p>
        {paymentProviders.map(p=>{const setup=setups.find(s=>s.provider===p.id);return <div className="payment-provider-setting" key={p.id}><h4>{p.name}</h4><label>Business payment link<input type="url" maxLength={1000} value={setup?.url||''} placeholder={p.example} onChange={e=>{if(!e.target.value){const next=setups.filter(s=>s.provider!==p.id);setValue({...value,payment_service_setups:next,payment_links:next.filter(s=>s.include_by_default).map(({provider,url})=>({provider,url}))})}else setSetup(p.id,e.target.value.trim(),setup?.include_by_default||false)}}/></label><label className="settings-checkbox"><input type="checkbox" disabled={!setup?.url||!validPaymentLink(setup)} checked={setup?.include_by_default||false} onChange={e=>setSetup(p.id,setup?.url||'',e.target.checked)}/>Include on new invoices by default</label>{setup&&validPaymentLink(setup)&&<a className="secondary-button compact" href={setup.url} target="_blank" rel="noopener noreferrer">Test {p.name} link</a>}<p className="quiet">{p.id==='stripe'?'Use a reusable customer-entered-amount Payment Link for varying invoice balances. Finviant adds an invoice reference to buy.stripe.com links; it cannot change a fixed checkout price.':'Use your business profile payment link. Customers may need to enter the amount and invoice number.'}</p></div>})}
        <label>
          Payment instructions
          <textarea
            maxLength={2000}
            placeholder="Please include your invoice number with payment."
            value={value.payment_instructions}
            onChange={(e) =>
              setValue({ ...value, payment_instructions: e.target.value })
            }
          />
        </label>
        <p className="quiet">
          Use business/commercial payment accounts. Confirm payment in the
          provider account before recording it as paid in Finviant. A button
          click does not confirm payment. Use reusable links that accept different invoice amounts; a fixed-price link is unsuitable as a general invoice default.
        </p>
      </section>
      <section className="settings-inset">
        <h3>Include payment costs in pricing</h3>
        <label>
          Optional price adjustment (%)
          <input
            type="number"
            min="0"
            max="25"
            step="0.01"
            value={value.pricing_adjustment_percent}
            onChange={(e) =>
              setValue({
                ...value,
                pricing_adjustment_percent: Number(e.target.value),
              })
            }
          />
        </label>
        <p className="quiet">
          You can apply this adjustment to line prices while preparing an
          invoice. It is off by default and uses the same customer price for
          every payment method. Review the price with your customer before
          issuing the invoice. This is not a processor-specific surcharge or a
          guarantee of recovering exact fees.
        </p>
        <p className="quiet">
          This uniform pricing tool changes base prices for every payment method. Use the separate credit-card fee preference below for provider-specific recovery; it remains off until eligibility is verified.
        </p>
      </section>
      <SquareConnection business={business} onRedirect={()=>guard.markClean()}/>
      {error && <p className="form-message error-text" role="alert">{error}</p>}
      {notice && <p className="form-message" role="status">{notice}</p>}
      <button className="primary-button" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
    </form>
  );
}
