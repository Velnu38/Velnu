# Google Maps integration — Velnu staging

## Current behavior (works without a Google API key)

- **Locations** in the sidebar or mobile **More** lists the properties saved under Customers.
- Selecting a location offers **View on Google Maps** and **Get directions**.
- These links use the official [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) with \`api=1\`. They work on mobile browsers and can open the Google Maps app. Google determines whether to use the device’s location as the driving origin.
- A property card under **Customers → Properties** offers the same actions.
- The **Jobs** and **Schedule** screens now let a business owner choose an existing property when creating a job; maps and directions appear on a job or appointment after a location is assigned.
- Service addresses are stored per business in Supabase, and authenticated members access them through existing RLS policies. Google links include only street/city/state/postal-code—not customer names, employee details, \`access_notes\`, or gate codes.

## Enable an embedded interactive map (optional)

An official embedded map needs the Google Maps **Embed API**, a Google Cloud project with billing, and a browser API key. Unlike directions links, the embedded iframe cannot work without this key.

1. Visit [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/credentials).
2. Choose or create your Maps project; link a billing account and enable **Maps Embed API**.
3. Create an API key restricted under **Application restrictions → Websites (HTTP referrers)**.
4. Allow the Velnu staging preview origin, for example:
   \`https://velnu-git-feature-velnu-stage1-mbarone5-1747.vercel.app/*\`
   Add your verified production domain later. Do not allow arbitrary \`*.vercel.app\` websites.
5. Under **API restrictions**, permit only **Maps Embed API**. Configure Google Cloud alerts and quota limits.
6. In the Velnu Vercel project, add \`VITE_GOOGLE_MAPS_EMBED_KEY\` to the **Preview** environment (the key is delivered to browser code and must be website/API restricted; it is *not* a backend secret). Redeploy the development branch so Vite includes the variable.
7. In Locations, select a property and tap **Show map here**. This embeds the Google map only after the user opts in. The existing View / Directions links continue working even without an embedded map.

Official docs: [Embed API quickstart](https://developers.google.com/maps/documentation/embed/quickstart), [API key restrictions](https://developers.google.com/maps/documentation/javascript/get-api-key), [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).

## Costs (Google-published US/global list, October 26, 2026)

- **View on Google Maps / Get directions via Maps URLs**: no Google API key or billable Maps API call required.
- **Maps Embed API** (an iframe inside Velnu): Google lists the **Embed SKU as unlimited no-charge usage**. You still need a Google Cloud project, billing account and correctly restricted API key to enable this version.
- **Dynamic Maps** (more complex interactive maps): first **10,000 monthly map loads free**, then **$7/1,000** loads at the first paid tier.
- **Places Autocomplete (New)** for service address suggestions: first **10,000 billable requests/month free**, then **$2.83/1,000** (other Places SKUs may add charges).
- **Geocoding**: first **10,000 requests/month free**, then **$5/1,000**.

Google's $100/month Starter, $275/month Essentials, and $1,200/month Pro **subscriptions are optional alternatives** to pay-as-you-go, **not required** for Velnu. Set usage budgets, cost alerts and quotas before enabling billable APIs.

Official price list: https://developers.google.com/maps/billing-and-pricing/pricing ; Overview: https://developers.google.com/maps/billing-and-pricing/overview

## Limitations / future extensions

- Map search uses the address text and may land on an ambiguous result if the address is incomplete; users should verify the Google Maps pin.
- Velnu does **not** yet implement Google Places autocomplete, automatic geocoding, turn-by-turn navigation within Velnu, mileage billing, live GPS tracking, staff location monitoring, or route optimization. These would require additional product requirements, separate API choices, privacy controls, tests, and possibly costs.
- A signed-in company owner must add service-property addresses under Customers first. Older jobs with no property assignment will not yet show a map link.
- Google receives the service address when a user clicks its map/directions URL, or when a configured map iframe is explicitly opened. The preview has no automatic third-party map calls.
- Until Google Cloud is configured, there is **no embedded iframe**, but all Google Maps URL navigation actions still work.
- Changes are on branch \`feature/velnu-stage1\`, backed by Supabase \`Owedly-Test\`, not the production \`main\` branch.
