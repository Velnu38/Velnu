export const AGREEMENT_VERSION = '2026-10-26-v1'
export const AGREEMENT_EFFECTIVE_DATE = 'October 26, 2026'

export const termsSections = [
  {
    title: '1. Agreement, authority, and business accounts',
    paragraphs: [
      'These Velnu Business User Terms apply to individuals and organizations using Velnu, including free and preview accounts. By accepting, you confirm you are at least 18, have authority to enter this agreement, and are authorized to act for any business account you create.',
      'Your business is responsible for its authorized owners, employees, contractors, and other users. It must control permissions, provide appropriate training, and remove access when an authorized user should no longer access its records.'
    ]
  },
  {
    title: '2. AI features, voice recordings, and human review',
    paragraphs: [
      'Velnu includes or may offer AI-assisted speech transcription, drafting, searching, and interpretation of business requests. When enabled, recordings, transcribed words, prompts, and relevant business or customer context may be sent to OpenAI or another disclosed AI provider to process your request. Features may be unavailable during the preview.',
      'AI can be wrong, incomplete, or misleading. Before saving, approving, sending, or relying on an invoice, estimate, amount, tax, schedule, customer record, or proposed action, you must review and correct it. AI output is not legal, tax, accounting, employment, safety, or other professional advice.',
      'You are responsible for any legally required notices or permissions before recording someone, processing employee or customer data, or submitting another person’s information. Do not submit sensitive employee, medical, government-identification, or payment-card data that is not necessary for the service.'
    ]
  },
  {
    title: '3. Business records, customers, and payments',
    paragraphs: [
      'You control and are responsible for the accuracy, legality, privacy, recordkeeping, customer terms, taxes, and communications relating to content entered into your workspace. Velnu is not a party to your separate agreements with customers.',
      'You must check whether a document was actually delivered and whether funds were actually received. Recording a manual payment is bookkeeping only; it does not charge a card or transfer money.'
    ]
  },
  {
    title: '4. Employees, workers, and business responsibility',
    paragraphs: [
      'Your organization determines which people may use its workspace, their job responsibilities, and which records they can access. You must follow applicable employment, workplace privacy, recording, consumer-protection, and data-protection laws and policies.',
      'Velnu and its operator are not the employer or supervisor of your personnel and do not control their on-site work, safety procedures, wages, or conduct. Nothing in this agreement removes statutory or other nonwaivable employee rights.'
    ]
  },
  {
    title: '5. Account security and acceptable use',
    paragraphs: [
      'Protect your login, keep registration information current, and take reasonable steps to prevent unauthorized access. Do not use Velnu for fraud, misleading invoices, unlawful surveillance, spam, infringement, harassment, or other illegal activities.',
      'You may not access another business’s records, circumvent restrictions, attack the platform, or misuse any customer or employee data.'
    ]
  },
  {
    title: '6. Information and service providers',
    paragraphs: [
      'Velnu uses providers for website hosting, authentication, data storage, and optional email and AI functions. Relevant information may be processed by those providers as needed for the requested service. See the Velnu Privacy Notice for information categories and preview limitations.',
      'Business profile details supply context to AI features and do not mean a model is permanently trained for your company. The provider’s applicable retention, training, and data-handling arrangements must be verified for the specific integration before general launch.'
    ]
  },
  {
    title: '7. Preview functionality and future pricing',
    paragraphs: [
      'Velnu is in private development testing. Features identified as in development or coming soon may be changed, delayed, or unavailable. Free, Basic, and Pro entitlements and any paid subscription terms will be published before payment is requested. Accepting these terms does not authorize a charge.',
      'Preview access may be interrupted, changed, suspended, or withdrawn. Keep copies of important records, especially where retention is legally required.'
    ]
  },
  {
    title: '8. Content ownership and license',
    paragraphs: [
      'You retain rights in content you lawfully submit. You grant Velnu and its authorized providers a limited license to process, store, transmit, and display that content as necessary to provide, maintain, and secure the functions you use, subject to applicable law and privacy disclosures. You represent you have authority to submit the content.',
      'The software, product name, and underlying Velnu intellectual property remain with their respective owners.'
    ]
  },
  {
    title: '9. Service disclaimers',
    paragraphs: [
      'To the maximum extent the law permits, Velnu is provided on an as-is and as-available basis. It does not guarantee uninterrupted access, error-free AI output, legal sufficiency, financial results, successful email delivery, payment collection, or the restoration of lost data.',
      'Nothing in this agreement excludes warranties, duties, statutory remedies, or other rights that cannot lawfully be excluded.'
    ]
  },
  {
    title: '10. Limits on liability',
    paragraphs: [
      'To the extent permitted by applicable law, Velnu’s operator and its owners, directors, officers, employees, contractors, and agents are not liable for indirect, incidental, special, consequential, or punitive damages, lost profits, or business interruption arising from the service. Their combined liability for claims subject to lawful contractual limitation will not exceed the greater of US $100 or fees you paid for Velnu in the twelve months before the event giving rise to the claim.',
      'These limits do not apply where prohibited by law and do not purport to excuse fraud, intentional misconduct, gross negligence, or any nonwaivable legal responsibility.'
    ]
  },
  {
    title: '11. Third-party claims and indemnification',
    paragraphs: [
      'To the extent permitted by law, the business account holder agrees to defend and indemnify Velnu’s operator and its owners, officers, employees, and agents from third-party claims arising from the business’s unlawful use of Velnu, unauthorized data submissions, infringement, or customer or worker disputes caused by the business’s own services, actions, or omissions.',
      'This obligation does not cover claims to the extent caused by the protected party’s own unlawful conduct, gross negligence, or intentional misconduct or where indemnification is prohibited. Individual workers do not personally assume their employer’s obligations merely because they are authorized platform users.'
    ]
  },
  {
    title: '12. Electronic notice, changes, and termination',
    paragraphs: [
      'You consent to receive these business-account terms and Velnu administrative notices electronically, and may save or print a copy. You may decline and not use the service. Customer-facing electronic contracting and legally required consumer disclosures must independently comply with applicable law.',
      'We may suspend or terminate access for serious misuse or security risks. Material changes to this agreement will require a new affirmative acceptance before continued workspace use. Mandatory legal protections remain effective despite any contract provision.'
    ]
  }
]
export const privacySections = [
  {
    title: 'Information involved',
    paragraphs: [
      'Velnu may process account email and identifiers; company contact and logo data; business services and team descriptions; customer and job records; estimates, invoices, and payment records entered by users; and operational and security events.',
      'Where optional voice and AI tools are enabled, recorded audio, transcripts, prompts, and relevant business details may be transferred to the configured AI provider to process the requested task.'
    ]
  },
  {
    title: 'Use of information',
    paragraphs: [
      'The information supports sign-in, account permissions, invoicing, estimates, customer and job workflows, troubleshooting, security, and optional AI requests. Business profiles provide reusable context, not a promise of AI model training.',
      'Never upload highly sensitive employee, medical, payment-card, or government identification information unless specifically authorized and needed for a feature.'
    ]
  },
  {
    title: 'Service providers',
    paragraphs: [
      'The preview uses Supabase for authentication and business data, Vercel for website hosting, and may use OpenAI for voice and AI tasks. Resend customer email delivery is not yet enabled. When you click a Google Maps or directions link, Velnu passes the selected service street address to Google in a URL. If an embedded map is enabled, Google receives the address when you choose to show that map. Google Maps has its own terms and privacy practices. Velnu never includes private property access notes or gate codes in map links. The processing arrangements and retention terms of each provider require verification for the final deployment.',
      'Logos uploaded for public documents may be accessible to anyone with the file URL. Do not upload confidential photos as business logos.'
    ]
  },
  {
    title: 'Security and your choices',
    paragraphs: [
      'Velnu uses sign-in and business-specific access controls. No online service guarantees complete security. You choose what information to submit and whether to use optional voice and AI tools. Each business must provide its own legally required notices to customers, employees, and contractors.',
      'Data retention, deletion and export rights, support contacts, incident notice procedures, and regional privacy disclosures must be finalized before the public release.'
    ]
  },
  {
    title: 'Private preview disclaimer',
    paragraphs: [
      'This is a preliminary privacy notice, not a finished public privacy policy. The Velnu operator’s verified legal identity, contact, retention commitments, and jurisdiction-specific disclosures require completion and professional review before launch.'
    ]
  }
]
