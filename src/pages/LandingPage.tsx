import {useEffect,useRef,useState} from 'react'
import {workflowScenes,outcomeScenes} from '../lib/marketingContent'

export default function LandingPage(){
 const reduced=typeof matchMedia==='function' && matchMedia('(prefers-reduced-motion: reduce)').matches
 const [stage,setStage]=useState(0),[playing,setPlaying]=useState(!reduced),[selectedOutcome,setSelectedOutcome]=useState(0),[proSending,setProSending]=useState(true),[workers,setWorkers]=useState(['Jordan'])
 const demo=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(true),[foreground,setForeground]=useState(true)
 const scene=workflowScenes[stage],outcome=outcomeScenes[selectedOutcome]
 useEffect(()=>{const change=()=>setForeground(!document.hidden);document.addEventListener('visibilitychange',change);return()=>document.removeEventListener('visibilitychange',change)},[])
 useEffect(()=>{if(!demo.current||typeof IntersectionObserver==='undefined')return;const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting),{threshold:.2});observer.observe(demo.current);return()=>observer.disconnect()},[])
 useEffect(()=>{if(!playing||!visible||!foreground)return;const timer=setInterval(()=>setStage(index=>(index+1)%workflowScenes.length),4200);return()=>clearInterval(timer)},[playing,visible,foreground])
 useEffect(()=>{if(reduced||typeof IntersectionObserver==='undefined')return;const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('fp-enter');observer.unobserve(e.target)}}),{threshold:.12});document.querySelectorAll('#finviant-proposal .fp-reveal').forEach(e=>observer.observe(e));return()=>observer.disconnect()},[reduced])
 return (<div id="finviant-proposal" className="marketing-page">{"\n"}{"\n"}<div className="fp-top">{"Private beta · Approved testers only · Public pricing is planned; no subscription charges during testing."}
</div>{"\n"}<header className="fp-wrap fp-nav">
<a className="fp-brand cursor-interaction" href="#fp-home">
<img className="fp-logo" alt="Finviant logo" src="/finviant-mark.svg" />
<span>{"Finviant"}<span style={{"color":"var(--fp-teal)"}}>{"."}
</span>
</span>
</a>
<nav className="fp-navlinks" aria-label="Main navigation">
<a className="cursor-interaction" href="#fp-features">{"Why Finviant"}
</a>
<a className="cursor-interaction" href="#fp-pro">{"Business Pro"}
</a>
<a className="cursor-interaction" href="#fp-plans">{"Plans"}
</a>
</nav>
<div className="fp-entry">
<a href="/auth?mode=signin" className="cursor-interaction fp-signin marketing-signin">{"Sign in"}
</a>
<a className="fp-action cursor-interaction" href="/auth?mode=signup">{"Get started "}<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
<path d="M7 17 17 7M7 7h10v10">
</path>
</svg>
</a>
</div>
</header>{"\n"}<main>{"\n"}<section className="fp-hero" id="fp-home">
<div className="fp-wrap fp-hero-layout">
<div>
<p className="fp-kicker">{"Business Pro · Your connected back office"}
</p>
<h1>{"Your business."}<br />
<span>{"Connected from"}<br />{"start to finish."}
</span>
</h1>
<p className="fp-hero-lead">{"Win approval. Plan the crew. Deliver the job. Send the invoice. Business Pro brings the work and the follow-through into one workspace, on your phone or computer."}
</p>
<div className="fp-herolinks">
<a href="#fp-suite" className="fp-action cursor-interaction">{"See Business Pro in action "}<span aria-hidden="true">{"↓"}
</span>
</a>
<a href="#fp-plans" className="fp-link cursor-interaction">{"Compare plans"}
</a>
</div>
<p className="fp-fine">{"Built for service businesses. Private beta · Approved testers only."}
</p>
<div className="fp-heroproof">
<span>
<b>{"25"}
</b>{"worker profiles"}
</span>
<span>
<b>{"5"}
</b>{"account users"}
</span>
<span>
<b>{"One"}
</b>{"connected workspace"}
</span>
</div>
</div>
<div>
<div className="fp-demo" aria-label="Interactive illustrative job workflow" ref={demo} onFocusCapture={() => setPlaying(false)}>
<div className="fp-demohead">
<b>{"Finviant Office"}
</b>
<span>{"Business Pro example"}
</span>
</div>
<div className="fp-stages" role="group" aria-label="Explore the Business Pro workflow">
<button type="button" data-stage="0" aria-pressed={stage === 0} className="cursor-interaction" onClick={() => {setStage(0);setPlaying(false)}}>{"1. Estimate"}
</button>
<button type="button" data-stage="1" aria-pressed={stage === 1} className="cursor-interaction" onClick={() => {setStage(1);setPlaying(false)}}>{"2. Approval"}
</button>
<button type="button" data-stage="2" aria-pressed={stage === 2} className="cursor-interaction" onClick={() => {setStage(2);setPlaying(false)}}>{"3. Schedule"}
</button>
<button type="button" data-stage="3" aria-pressed={stage === 3} className="cursor-interaction" onClick={() => {setStage(3);setPlaying(false)}}>{"4. Work"}
</button>
<button type="button" data-stage="4" aria-pressed={stage === 4} className="cursor-interaction" onClick={() => {setStage(4);setPlaying(false)}}>{"5. Invoice"}
</button>
<button type="button" data-stage="5" aria-pressed={stage === 5} className="cursor-interaction" onClick={() => {setStage(5);setPlaying(false)}}>{"6. Track"}
</button>
</div>
<div className="fp-job" aria-live={playing ? "off" : "polite"}>
<p className="fp-kicker" id="fp-record">{scene.record}
</p>
<span className="fp-status" id="fp-status">{scene.status}
</span>
<h3>{"Fall yard cleanup"}
</h3>
<p id="fp-stagecopy">{scene.copy}
</p>
<div className="fp-jobline">
<span id="fp-detail">{scene.detail}
</span>
<b id="fp-value">{scene.value}
</b>
</div>
</div>
<div className="fp-progress" aria-hidden="true">
<span id="fp-progress" style={{width: ((stage+1)/workflowScenes.length*100)+"%"}}>
</span>
</div>
<div className="fp-demobottom">
<span className="fp-dot">
</span>
<span id="fp-sync">{scene.next}
</span>
</div>
</div>
<div className="fp-demo-controls">
<span className="fp-example">{"Follow one job · animated example"}
</span>
<button type="button" id="fp-play" aria-pressed={playing} className="cursor-interaction" onClick={() => setPlaying(value => !value)}>{playing ? 'Pause demo' : 'Play demo'}
</button>
<button type="button" id="fp-replay" className="cursor-interaction" onClick={() => {setStage(0);setPlaying(true)}}>{"Replay"}
</button>
</div>
</div>
</div>
</section>{"\n"}<div className="fp-wrap">
<div className="fp-audiences">
<b>{"Made for businesses that keep moving"}
</b>
<span>{"Home services"}
</span>
<span>{"Trades"}
</span>
<span>{"Landscaping"}
</span>
<span>{"Local service teams"}
</span>
</div>{"\n"}<section className="fp-section" id="fp-features">
<div className="fp-section-intro">
<div>
<p className="fp-kicker">{"From first conversation to final follow-up."}
</p>
<h2>{"The job is only part"}<br />{"of running the business."}
</h2>
</div>
<p>{"The estimate, the crew, the customer and the money all need your attention. Business Pro connects those steps so you can see what happens next."}
</p>
</div>
<div className="fp-three">
<article className="fp-benefit fp-reveal">
<div className="fp-num">{"01 / LOOK THE PART"}
</div>
<h3>{"Send work you’re proud to put your name on."}
</h3>
<p>{"Create estimates, invoices and change orders with a consistent PDF. Review the same finished document your customer receives."}
</p>
<p className="fp-proof">{"PDF creation on every plan"}
</p>
</article>
<article className="fp-benefit fp-reveal">
<div className="fp-num">{"02 / KEEP YOUR CREW CLEAR"}
</div>
<h3>{"Put the right people on the job."}
</h3>
<p>{"Build your worker roster, set hours and time off, and assign one person or a whole crew. See the plan before you commit to the next job."}
</p>
<p className="fp-proof">{"25 worker profiles + 5 account users on Pro"}
</p>
</article>
<article className="fp-benefit fp-reveal">
<div className="fp-num">{"03 / ASK FIN"}
</div>
<h3>{"Say it. Review it. Move on."}
</h3>
<p>{"Ask Fin to find business records or prepare a document draft. Review the customer, work details and totals before confirming changes."}
</p>
<p className="fp-proof">{"Typed and voice assistance · In beta"}
</p>
</article>
</div>
</section>{"\n"}<section className="fp-suite fp-reveal" id="fp-suite" aria-label="Business Pro benefit explorer">
<div className="fp-suite-top">
<div>
<p className="fp-kicker">{"One business. One connected workflow."}
</p>
<h2>{"Keep the whole job"}<br />{"moving forward."}
</h2>
</div>
<p>{"Explore the moments that make Business Pro your everyday business workspace. Select a benefit to see how the pieces connect."}
</p>
</div>
<div className="fp-suite-tabs" role="group" aria-label="Explore Business Pro benefits">
<button type="button" data-outcome="0" aria-pressed={selectedOutcome === 0} onClick={() => setSelectedOutcome(0)}>{"01 · Win approval"}
</button>
<button type="button" data-outcome="1" aria-pressed={selectedOutcome === 1} onClick={() => setSelectedOutcome(1)}>{"02 · Coordinate the work"}
</button>
<button type="button" data-outcome="2" aria-pressed={selectedOutcome === 2} onClick={() => setSelectedOutcome(2)}>{"03 · Follow through"}
</button>
<button type="button" data-outcome="3" aria-pressed={selectedOutcome === 3} onClick={() => setSelectedOutcome(3)}>{"04 · See the business"}
</button>
</div>
<div className="fp-suite-body">
<div className="fp-suite-copy" aria-live="polite">
<p className="fp-kicker" id="fp-outcome-kicker">{outcome.kicker}
</p>
<h3 id="fp-outcome-title">{outcome.title}
</h3>
<p id="fp-outcome-copy">{outcome.copy}
</p>
<a href="#fp-plans" className="fp-link">{"Explore Business Pro →"}
</a>
<p className="fp-suite-note" id="fp-outcome-note">{outcome.note}
</p>
</div>
<div className="fp-workspace" aria-label="Illustrative Business Pro workspace">
<div className="fp-workspace-head">
<b>{"Finviant Office"}
</b>
<span>{"BUSINESS PRO"}
</span>
</div>
<h4 id="fp-workspace-title">{outcome.heading}
</h4>
<p id="fp-workspace-copy">{outcome.sub}
</p>
<div id="fp-workspace-rows">{outcome.rows.map(row => <div key={row[0]} className="fp-mockrow">
<span>
<b>{row[0]}
</b>
<small>{row[1]}
</small>
</span>
<em>{row[2]}
</em>
</div>)}
</div>
<div className="fp-workspace-foot">
<span className="fp-dot">
</span>
<span>{"Illustrative product view · Select another benefit above"}
</span>
</div>
</div>
</div>
</section>
<section className="fp-worker-section fp-reveal" id="fp-workers">
<div className="fp-worker-grid">
<div className="fp-worker-copy">
<p className="fp-kicker">{"More capacity. More control."}
</p>
<h2>{"A bigger crew."}<br />{"A clearer picture."}
</h2>
<p>{"Running more jobs means coordinating more people. With 25 active worker profiles on Pro, build a roster of employees, helpers or subcontractors and assign the right crew without creating an account for every person."}
</p>
<ul>
<li>
<b>{"Know who is assigned."}
</b>{" Put one or several workers on each job."}
</li>
<li>
<b>{"Plan around availability."}
</b>{" Record working hours and time off, and check scheduling conflicts."}
</li>
<li>
<b>{"Keep everyone’s work visible."}
</b>{" Follow assignments across Jobs and your schedule."}
</li>
<li>
<b>{"Keep office access separate."}
</b>{" Adding a worker does not grant access to your account."}
</li>
</ul>
<p className="fp-worker-note">{"Individual: up to 5 active worker profiles."}<br />{"Business Pro: up to 25, plus 5 account users."}<br />{"The owner counts only when included as an active worker."}
</p>
</div>
<div className="fp-roster" aria-label="Example internal crew assignment">
<header>
<h3>{"Assign workers"}
</h3>
<p>{"Fall yard cleanup · Illustrative assignment"}
</p>
</header>
<label className="fp-worker-row">
<input type="checkbox" data-worker="Jordan" checked={workers.includes("Jordan")} onChange={e => setWorkers(previous => e.target.checked ? [...previous, "Jordan"] : previous.filter(name => name !== "Jordan"))} />
<span>
<b>{"Jordan Lee"}
</b>
<small>{"Landscaping · 8 AM–4 PM"}
</small>
</span>
<em>{"Available"}
</em>
</label>
<label className="fp-worker-row">
<input type="checkbox" data-worker="Sam" onChange={e => setWorkers(previous => e.target.checked ? [...previous, "Sam"] : previous.filter(name => name !== "Sam"))} />
<span>
<b>{"Sam Morgan"}
</b>
<small>{"Maintenance · 8 AM–4 PM"}
</small>
</span>
<em>{"Available"}
</em>
</label>
<label className="fp-worker-row">
<input type="checkbox" disabled />
<span>
<b>{"Taylor Reed"}
</b>
<small>{"Time off today"}
</small>
</span>
<em>{"Unavailable"}
</em>
</label>
<div className="fp-roster-footer">
<b id="fp-crew-summary" aria-live="polite">{workers.length ? 'Assigned: '+workers.join(' + ') : 'Select available workers'}
</b>
<span>{"Example: one owner account manages these worker records. Workers receive no login or notification."}
</span>
</div>
</div>
</div>
</section>
<section className="fp-prosection fp-reveal" id="fp-pro">
<div className="fp-progrid">
<div>
<p className="fp-kicker">{"The follow-through is built in"}
</p>
<h2>{"Keep work moving."}<br />
<span>{"Even after you hit send."}
</span>
</h2>
<p className="fp-lead">{"A professional document starts the conversation. Business Pro keeps sending, customer booking and follow-up connected to the work you’re managing."}
</p>
<div className="fp-prolist">
<div className="fp-proitem">
<span aria-hidden="true">{"✓"}
</span>
<div>
<b>{"Send the PDF from Finviant"}
</b>
<small>{"Direct email delivery and delivery updates after activation."}
</small>
</div>
</div>
<div className="fp-proitem">
<span aria-hidden="true">{"✓"}
</span>
<div>
<b>{"Give customers a time to choose"}
</b>
<small>{"Private booking links use your configured availability and update the job and calendar."}
</small>
</div>
</div>
<div className="fp-proitem">
<span aria-hidden="true">{"✓"}
</span>
<div>
<b>{"Bring the office and the crew together"}
</b>
<small>{"5 account users, including you. 25 active internal worker profiles for your field crew."}
</small>
</div>
</div>
<div className="fp-proitem">
<span aria-hidden="true">{"✓"}
</span>
<div>
<b>{"Follow up on your schedule"}
</b>
<small>{"Scheduled sending and owner-enabled reminder rules after activation."}
</small>
</div>
</div>
</div>
</div>
<div className="fp-sending">
<div className="fp-sendtabs" role="group" aria-label="Compare email delivery">
<button type="button" data-send="personal" aria-pressed={proSending === false} className="cursor-interaction" onClick={() => setProSending(false)}>{"Free"}
</button>
<button type="button" data-send="pro" aria-pressed={proSending === true} className="cursor-interaction" onClick={() => setProSending(true)}>{"Business Pro"}
</button>
</div>
<div className="fp-sendbody" aria-live="polite">
<span className="fp-status" id="fp-sendbadge">{proSending ? 'Stays in Finviant' : 'Finish in your own app'}
</span>
<h3 id="fp-sendtitle">{proSending ? 'Your document. Delivered.' : 'Your document. Your email app.'}
</h3>
<p id="fp-sendcopy">{proSending ? 'Send email directly from Finviant with the finished PDF attached. Follow delivery updates in your workspace.' : 'Create the same professional PDF, then share it through your device. Some devices require downloading and attaching it yourself.'}
</p>
<div className="fp-attachment">
<span className="fp-pdfmark" aria-hidden="true">{"PDF"}
</span>
<div>
<b>{"Invoice INV-1042.pdf"}
</b>
<br />{"Same document. Every step."}
</div>
</div>
<div className="fp-sendlabel" id="fp-sendlabel">{proSending ? 'Direct email + PDF attachment' : 'You finish sending in your app'}
</div>
<p style={{"fontSize":"11px","minHeight":"0","marginTop":"13px"}} id="fp-sendnote">{proSending ? 'Sender activation required. Beta sending is limited to approved recipients. This example sends no message.' : 'Personal-app sending cannot verify delivery in Finviant. This example opens no email app.'}
</p>
</div>
</div>
</div>
</section>{"\n"}<section className="fp-section" id="fp-plans">
<div className="fp-priceintro">
<p className="fp-kicker">{"Choose how you run your business"}
</p>
<h2>{"Essentials to start."}<br />{"Business Pro to connect it all."}
</h2>
<p>{"Free gets you organized. Individual adds capacity for an owner. Business Pro connects the office, the crew and the customer journey."}
</p>
</div>
<div className="fp-plans">
<article className="fp-plan fp-reveal">
<h3>{"Free"}
</h3>
<p>{"A professional starting point for occasional work."}
</p>
<div className="fp-price">{"$0"}<span>{" / month"}
</span>
</div>
<ul>
<li>{"10 active customers"}
</li>
<li>{"5 new job bookings / month"}
</li>
<li>{"Estimates, invoices & change orders"}
</li>
<li>{"PDF download and sharing"}
</li>
<li>{"Your email and text apps"}
</li>
<li>{"20 Fin requests + 10 voice minutes, once"}
</li>
</ul>
<a href="/auth?mode=signup" className="fp-link cursor-interaction">{"Start with Free →"}
</a>
</article>
<article className="fp-plan fp-reveal">
<h3>{"Individual"}
</h3>
<p>{"One account for an owner managing a growing workload."}
</p>
<div className="fp-price">{"$19.95"}<span>{" / month"}
</span>
</div>
<ul>
<li>{"No customer or document count cap"}
</li>
<li>{"No job booking count cap"}
</li>
<li>{"5 active worker profiles"}
</li>
<li>{"250 manually initiated email deliveries/month*"}
</li>
<li>{"Your logo on documents"}
</li>
<li>{"150 Fin requests / month"}
</li>
<li>{"60 voice minutes / month"}
</li>
<li>{"2 GB attachments + full financial history"}
</li>
</ul>
<a href="/auth?mode=signup" className="fp-link cursor-interaction">{"Choose Individual →"}
</a>
</article>
<article className="fp-plan fp-featured fp-reveal">
<span className="fp-recommend">{"THE CONNECTED BUSINESS SOLUTION"}
</span>
<h3>{"Business Pro"}
</h3>
<p>{"Your connected workflow from estimate to invoice, with team access, customer booking and managed follow-up."}
</p>
<div className="fp-price">{"$39.95"}<span>{" / month"}
</span>
</div>
<ul>
<li>
<b>{"Everything in Individual"}
</b>
</li>
<li>
<b>{"5 account users + 25 workers"}
</b>
</li>
<li>{"Finviant-managed email and SMS*"}
</li>
<li>{"2,000 email recipients / month"}
</li>
<li>{"200 US SMS segments / month*"}
</li>
<li>{"Customer self-booking links"}
</li>
<li>{"600 Fin requests + 180 voice minutes / month"}
</li>
<li>{"10 GB shared attachment storage"}
</li>
</ul>
<a href="/auth?mode=signup" className="fp-link cursor-interaction">{"Choose Business Pro →"}
</a>
</article>
</div>
<p className="fp-pricenote">
<b>{"For $20 more per month than Individual, connect your team, customer booking, scheduled sending and automatic overdue follow-up in Business Pro."}
</b>
<br />
<b>{"Planned public pricing, USD per business. Business Pro annual: $399.50 upfront ($33.29/month equivalent)."}
</b>{" This private beta does not activate subscriptions or charge these amounts. *Managed email, SMS and reminders require sender activation; SMS registration and consent requirements apply. Pro allowances are shared across the business."}
</p>{"\n"}<h3 className="fp-tabletitle">{"A clear view of what changes."}
</h3>
<table className="fp-comparison">
<thead>
<tr>
<th scope="col">{"Included"}
</th>
<th scope="col">{"Free"}
</th>
<th scope="col">{"Individual"}
</th>
<th scope="col">{"Business Pro"}
</th>
</tr>
</thead>
<tbody>
<tr>
<th scope="row">{"Professional PDFs"}
</th>
<td>{"Included"}
</td>
<td>{"Included"}
</td>
<td>{"Included"}
</td>
</tr>
<tr>
<th scope="row">{"Sending email"}
</th>
<td>{"Your email app"}
</td>
<td>{"Inside Finviant · 250/month*"}
</td>
<td>
<b>{"Inside Finviant*"}
</b>
</td>
</tr>
<tr>
<th scope="row">{"Customer self-booking"}
</th>
<td>{"—"}
</td>
<td>{"—"}
</td>
<td>
<b>{"Included*"}
</b>
</td>
</tr>
<tr>
<th scope="row">{"Scheduled sending & reminder rules"}
</th>
<td>{"Manual follow-up"}
</td>
<td>{"Manual follow-up"}
</td>
<td>
<b>{"Owner enabled*"}
</b>
</td>
</tr>
<tr>
<th scope="row">{"Active worker profiles"}
</th>
<td>{"Owner only"}
</td>
<td>{"5"}
</td>
<td>
<b>{"25"}
</b>
</td>
</tr>
<tr>
<th scope="row">{"Account users"}
</th>
<td>{"1"}
</td>
<td>{"1"}
</td>
<td>
<b>{"5 including owner"}
</b>
</td>
</tr>
<tr>
<th scope="row">{"Manual calendar & assignments"}
</th>
<td>{"Owner only; 5 job bookings / month"}
</td>
<td>{"5 workers; no booking count cap"}
</td>
<td>{"25 workers; no booking count cap"}
</td>
</tr>
<tr>
<th scope="row">{"Company logo"}
</th>
<td>{"Finviant branding"}
</td>
<td>{"Your uploaded logo"}
</td>
<td>{"Your uploaded logo"}
</td>
</tr>
<tr>
<th scope="row">{"Financial history"}
</th>
<td>{"Last 30 days"}
</td>
<td>{"Full available history"}
</td>
<td>{"Full available history"}
</td>
</tr>
<tr>
<th scope="row">{"Fin requests"}
</th>
<td>{"20 once"}
</td>
<td>{"150 / month"}
</td>
<td>
<b>{"600 / month"}
</b>
</td>
</tr>
<tr>
<th scope="row">{"Voice minutes"}
</th>
<td>{"10 once"}
</td>
<td>{"60 / month"}
</td>
<td>
<b>{"180 / month"}
</b>
</td>
</tr>
<tr>
<th scope="row">{"Attachment storage"}
</th>
<td>{"100 MB"}
</td>
<td>{"2 GB"}
</td>
<td>
<b>{"10 GB shared"}
</b>
</td>
</tr>
</tbody>
</table>{"\n"}<div className="fp-details"><details><summary>Can I manage more than one business?</summary><p>This release supports one business workspace per account on every tier. Pro’s five account users work within that same business. Separate business workspaces are not included.</p></details>
<details>
<summary>{"What is the difference between a worker and an account user?"}
</summary>
<p>{"A worker profile is an internal record used for availability and assignments. It does not grant login access or send worker notifications. An account user can sign in, subject to the permissions the owner grants. Inactive worker profiles keep their history without using the active allowance."}
</p>
</details>
<details>
<summary>{"Can I start without paying?"}
</summary>
<p>{"The Free plan is the starting point for occasional work. Finviant is currently in private beta: approved testers receive authorized test access without subscription charges. Public prices shown here are proposed, not an active checkout offer."}
</p>
</details>
<details>
<summary>{"Will my customer get the same PDF I reviewed?"}
</summary>
<p>{"Yes—the workflow uses the saved PDF version. Free shares through your device; a manual attachment may be necessary. Individual includes 250 manually initiated email deliveries per month, and Business Pro includes 2,000. Managed email includes the reviewed PDF after sender activation."}
</p>
</details>
<details>
<summary>{"Are online payments and every calendar integration ready?"}
</summary>
<p>{"Finviant supports payment links and recording full or partial payments. Automatic payment updates need a verified merchant connection; a payment-link click does not mark an invoice paid. External calendar connections require provider setup. Google Calendar setup is still pending. Native Tap to Pay and a complete customer portal are not being advertised as ready."}
</p>
</details>
<details>
<summary>{"Does Fin make changes without my review?"}
</summary>
<p>{"Fin can help prepare supported drafts and find authorized business records. Review and confirm changes before they are applied. AI results can be wrong and should be checked."}
</p>
</details>
</div>
</section>{"\n"}<section className="fp-last fp-reveal">
<p className="fp-kicker">{"Business Pro · Start to finish"}
</p>
<h2>{"You handle the work."}<br />{"Bring the business together."}
</h2>
<p>{"Give every estimate, customer, worker and invoice a place in one connected workflow."}
</p>
<div className="fp-last-links">
<a href="#fp-suite" className="fp-action cursor-interaction">{"Take another look "}<span aria-hidden="true">{"↑"}
</span>
</a>
<a href="/auth?mode=signup" className="fp-link">{"Choose Business Pro →"}
</a>
</div>
<p className="fp-fine">{"Private beta access is limited to approved testers."}
</p>
</section>{"\n"}{"\n"}<footer className="fp-footer">
<span>{"© Finviant Office · Private beta"}
</span>
<nav className="fp-legal" aria-label="Footer links">
<a href="/?view=dashboard">{"Open workspace"}
</a>
<a href="/install">{"Install"}
</a>
<a href="/legal">{"Agreement & privacy"}
</a>
</nav>
</footer>
</div>
</main>{"\n"}{"\n"}
</div>)
}
