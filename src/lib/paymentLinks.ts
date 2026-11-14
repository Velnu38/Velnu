import type { PaymentLink } from "../services/settings";
export const paymentProviders = [
  {id:'stripe',name:'Stripe',example:'https://buy.stripe.com/your-link'},
  {id:'square',name:'Square',example:'https://square.link/u/your-link'},
] as const;
/** Historical issued instructions retain their original provider labels. */
export function paymentProviderName(provider: string) {
  return ({stripe:'Stripe',square:'Square',venmo:'Venmo',paypal:'PayPal',cashapp:'Cash App'} as Record<string,string>)[provider] || provider;
}
const hosts: Record<string, string[]> = {
  square: ["square.link", "invoice.squareup.com"],
  venmo: ["venmo.com", "www.venmo.com", "account.venmo.com"],
  paypal: ["paypal.me", "paypal.com", "www.paypal.com"],
  stripe: ["buy.stripe.com", "invoice.stripe.com", "checkout.stripe.com"],
  cashapp: ["cash.app"],
};
export function validPaymentLink(link: { provider: string; url: string }) {
  try {
    const u = new URL(link.url);
    return (
      link.url.length <= 1000 &&
      !/[\s<>"\\]/.test(link.url) &&
      !/%(0a|0d|09|00)/i.test(link.url) &&
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      hosts[link.provider]?.includes(u.hostname) &&
      u.pathname.length > 1 &&
      (link.provider !== "cashapp" ||
        /^\/\$[A-Za-z0-9_-]+\/?$/.test(u.pathname))
    );
  } catch {
    return false;
  }
}
export function safePaymentLinks(links: unknown): PaymentLink[] {
  return Array.isArray(links)
    ? links.filter(
        (x): x is PaymentLink =>
          !!x &&
          typeof x.provider === "string" &&
          typeof x.url === "string" &&
          validPaymentLink(x),
      )
    : [];
}
export function adjustedPrice(price: string, percent: number): string {
  const n = Number(price);
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 25
  )
    throw new Error("Check the price and adjustment percentage.");
  return (
    Math.round((n * (1 + percent / 100) + Number.EPSILON) * 100) / 100
  ).toFixed(2);
}

/** Only documented URL capabilities are used; generic provider links remain unchanged. */
export function invoicePaymentUrl(link:PaymentLink,balance:number,reference:string,currency='USD'):string {
  if(!validPaymentLink(link)||!Number.isFinite(balance)||balance<=0)return link.url
  const u=new URL(link.url)
  if(link.provider==='paypal'&&u.hostname==='paypal.me'&&!u.search&&!u.hash&&/^\/[A-Za-z0-9]+\/?$/.test(u.pathname)){
    u.pathname=u.pathname.replace(/\/$/,'')+'/'+balance.toFixed(2)+currency;return u.toString()
  }
  if(link.provider==='stripe'&&u.hostname==='buy.stripe.com'&&!u.search&&!u.hash&&/^\/[A-Za-z0-9_]+$/.test(u.pathname)){
    const ref=reference.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,200)
    if(ref)u.searchParams.set('client_reference_id',ref)
    return u.toString()
  }
  return link.url
}
