# Interface control inventory

Generated with `node scripts/qa/interface-inventory.mjs`. Counts are JSX source definitions, not the number of rendered records. Includes every TSX file, including unused/compatibility screens. This is a source audit inventory; it does not certify a click on every dynamic control or an external provider transaction.

## src/App.tsx

2 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 153 | button | Try again | {() => location.reload()} |
| 153 | button | Sign out | {() => void supabase.auth.signOut()} |

## src/components/AccountAgreement.tsx

8 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 35 | a | <span className="marketing-logo"><img src="/finviant-mark.svg" alt="" /></span> <strong>Finviant</strong> | "/" |
| 40 | button | Not my account? Sign out | {onSignOut} |
| 53 | a | read, save, or print the complete agreement | "/legal" |
| 55 | input | "checkbox" | {e=>setAgree(e.target.checked)} |
| 56 | input | "checkbox" | {e=>setAi(e.target.checked)} |
| 57 | input | "checkbox" | {e=>setElectronic(e.target.checked)} |
| 60 | button | Decline & sign out | {onSignOut} |
| 60 | button | {busy?'Saving your acceptance…':'I agree · Continue to Finviant Office'} | {accept} |

## src/components/AiAssistantAccess.tsx

0 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |

## src/components/AnalyticsConsent.tsx

5 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 29 | a | Read our privacy notice | "/privacy" |
| 32 | button | Decline analytics | {() => select('declined')} |
| 33 | button | Allow analytics | {() => select('accepted')} |
| 49 | button | Turn off analytics | {() => chooseAnalyticsConsent('declined')} |
| 50 | button | Allow analytics | {() => chooseAnalyticsConsent('accepted')} |

## src/components/AppShell.tsx

11 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 131 | button | {item.label} | {() => navigate(item.id)} |
| 132 | a | Get app icon | "/install" |
| 132 | a | User agreement, AI & privacy | "/legal" |
| 132 | button | Sign out | {() => supabase.auth.signOut()} |
| 142 | button | {item.label} | {() => navigate(item.id)} |
| 144 | button | "More" | {() => setShowMobileMore(true)} |
| 148 | button | "Close" | {() => setShowMobileMore(false)} |
| 151 | button | {item.label} | {() => navigate(id)} |
| 153 | a | Agreement & privacy | "/legal" |
| 153 | a | App icon | "/install" |
| 153 | button | Sign out | {() => supabase.auth.signOut()} |

## src/components/ApprovalLinkDialog.tsx

4 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 16 | button | "Close" | {onClose} |
| 18 | input | Associated label | Native control |
| 20 | button | Close | {onClose} |
| 20 | button | {copied ? 'Copied' : 'Copy link'} | {copy} |

## src/components/AttentionReminders.tsx

1 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 8 | button | {'Complete ${row.note//'reminder'}'} | {()=>void done(row.id)} |

## src/components/AuthScreen.tsx

11 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 84 | a | <div className="logo-mark"><img src="/finviant-mark.svg" alt="" /></div> <div className="brand-word">Finviant Office</div> | "/" |
| 92 | input | "email" | {e => setEmail(e.target.value)} |
| 93 | input | "password" | {e => setPassword(e.target.value)} |
| 94 | button | {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'} | Form submit |
| 98 | button | Already registered? Sign in | {() => switchMode('signin')} |
| 99 | button | Forgot your password? | {() => switchMode('reset')} |
| 101 | button | Resend confirmation email | {resendConfirmation} |
| 102 | button | Forgot password? | {() => switchMode('reset')} |
| 103 | button |  {mode === 'signin' ? 'New to Finviant Office? Create an account' : 'Back to sign in'}  | {() => switchMode(mode === 'signin' ? 'signup' : 'signin')} |
| 106 | a | Finviant Office User Agreement (including AI disclosure and privacy) | "/legal" |
| 107 | a | Return to Finviant Office homepage | "/" |

## src/components/BillingHub.tsx

9 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 45 | button | Estimates <span aria-hidden="true">↗</span> | {() => onNavigate?.('estimates')} |
| 45 | button | Invoices <span aria-hidden="true">↗</span> | {() => onNavigate?.('invoices')} |
| 49 | button | <span>Needs Attention</span> <strong>{loading // error ? '—' : snapshot.overdueInvoiceCount + snapshot.pendingApprovalCount + extraAttention | {() => setFilter('attention')} |
| 51 | button | <span>Awaiting approval</span> <strong>{loading // error ? '—' : snapshot.pendingApprovalCount}</strong> <small>Estimates &amp; changes <spa | {() => setFilter('approvals')} |
| 53 | button | Needs Attention | {() => setFilter('attention')} |
| 53 | button | Recent | {() => setFilter('recent')} |
| 55 | button | View recent documents | {() => setFilter('recent')} |
| 55 | a | {'Open ${row.kind.toLowerCase()} ${row.number} for ${row.customer}'} | {row.href} |
| 72 | button | Open jobs <span aria-hidden="true">↗</span> | {onOpen} |

## src/components/BusinessOnboarding.tsx

2 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 17 | button | ← Back to business details | {()=>setPayments(false)} |
| 17 | button | Skip payment setup for now | {()=>onCreated(created)} |

## src/components/BusinessProfileEditor.tsx

10 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 118 | input | {placeholder} | {e => update(key, e.target.value)} |
| 150 | input | "file" | {e => chooseLogo(e.target.files?.[0] // null)} |
| 154 | button | Remove current logo from documents | {() => { setRemoveLogo(true); setLogo(null) }} |
| 157 | input | "color" | {e => update('document_accent', e.target.value)} |
| 160 | textarea | "Thank you for choosing our company." | {e => update('document_footer', e.target.value)} |
| 177 | textarea | "We are a residential plumbing company specializing in service calls…" | {e => update('business_description', e.target.value)} |
| 181 | textarea | "Faucet repairs, water heater installation, drain cleaning…" | {e => update('services_offered', e.target.value)} |
| 189 | textarea | "Owner handles quotes, two technicians do field work, office manager schedules jobs." | {e => update('team_roles', e.target.value)} |
| 204 | button | Back | {() => { setStep(companyOnly && step === 2 ? 0 : step - 1); setError('') }} |
| 205 | button | {busy ? 'Saving…' : step < 3 ? 'Continue' : editing ? 'Save company profile & services' : 'Create my business'} | Form submit |

## src/components/ContactImportDialog.tsx

10 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 25 | button | "Close contact import" | {close} |
| 27 | button | Choose phone contacts | {()=>void choosePhone()} |
| 28 | input | "file" | {e=>void file(e.target.files?.[0])} |
| 29 | summary | Import from iPhone | Native control |
| 30 | button | {selected.length===rows.length?'Deselect all':'Select all'} | {()=>setSelected(selected.length===rows.length?[]:rows.map(c=>c.id))} |
| 30 | input | "checkbox" | {e=>setSelected(ids=>e.target.checked?[...ids,c.id]:ids.filter(id=>id!==c.id))} |
| 30 | button | Previous contacts | {()=>setPage(n=>n-1)} |
| 30 | button | Next contacts | {()=>setPage(n=>n+1)} |
| 34 | button | Back to customers | {close} |
| 34 | button | {busy?'Importing…':pending.current?.length?'Retry remaining contacts':'Import selected contacts'} | {()=>void save()} |

## src/components/CustomerDetail.tsx

13 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 41 | button | Back to customers | {onBack} |
| 46 | button | ← Customers | {onBack} |
| 54 | button | + Add property | {()=>setShowProperty(true)} |
| 67 | button | "Close" | {()=>setShowProperty(false)} |
| 68 | input | "Home, Rental, Shop…" | {(e)=>setProperty({...property,label:e.target.value})} |
| 69 | input | Associated label | {(e)=>setProperty({...property,address_line1:e.target.value})} |
| 70 | input | Associated label | {(e)=>setProperty({...property,address_line2:e.target.value})} |
| 71 | input | Associated label | {(e)=>setProperty({...property,city:e.target.value})} |
| 72 | input | Associated label | {(e)=>setProperty({...property,state:e.target.value})} |
| 73 | input | Associated label | {(e)=>setProperty({...property,postal_code:e.target.value})} |
| 74 | textarea | "Gate code, parking, lockbox…" | {(e)=>setProperty({...property,access_notes:e.target.value})} |
| 76 | button | Cancel | {()=>setShowProperty(false)} |
| 76 | button | {busy?'Saving…':'Add property'} | Form submit |

## src/components/CustomerEntry.tsx

7 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 16 | input | "Customer name" | {e=>{onChange('');onDraft({...draft,name:e.target.value})}} |
| 17 | button | Use {name(c)} | {()=>onChange(c.id)} |
| 18 | summary | Add email or phone (optional) | Native control |
| 18 | input | "email" | {e=>onDraft({...draft,email:e.target.value})} |
| 18 | input | "tel" | {e=>onDraft({...draft,phone:e.target.value})} |
| 19 | summary | Choose from saved customers | Native control |
| 19 | select | "Customer" | {e=>onChange(e.target.value)} |

## src/components/CustomerPropertySelect.tsx

1 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 34 | select | "Service location" | {event => onChange(event.target.value)} |

## src/components/DocumentBrand.tsx

0 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |

## src/components/DocumentChangeOrderButton.tsx

2 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 9 | button | Retry change order access | {()=>setVersion(v=>v+1)} |
| 10 | button | {allowed===null?'Checking change order…':'Change order'} | {onClick} |

## src/components/FinancialPerformance.tsx

11 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 83 | button | {'${months} ${months === 1 ? 'month' : 'months'}'} | {() => { setPeriod(months); setSelected(null); setDetail(null); resetFilters() }} |
| 84 | button | Retry financial data | {() => setVersion(value => value + 1)} |
| 85 | button | Show entire period | {() => { setSelected(null); resetFilters() }} |
| 87 | button |  <span>{item.label}<span aria-hidden="true">{detail === item.kind ? '−' : '+'}</span></span> <strong>{ready ? usd.format(item.value) : '—'}< | {() => expand(item.kind)} |
| 92 | button | "Close transaction details" | {() => setDetail(null)} |
| 93 | input | "Description, source, or reference…" | {event => { setSearch(event.target.value); setPage(0) }} |
| 93 | select | <option value="all">All sources</option> <option value="invoice_payment">Invoice payments</option> <option value="manual">Manual & job entri | {event => { setSource(event.target.value); setPage(0) }} |
| 96 | a | View {row.source_view === 'work' ? 'job' : row.source_view === 'invoices' ? 'invoice' : 'estimate'} <span aria-hidden="true">↗</span> | {'/?view=${row.source_view}&document=${encodeURIComponent(row.source_id)}'} |
| 99 | button | Previous | {() => setPage(currentPage - 1)} |
| 99 | button | Next | {() => setPage(currentPage + 1)} |
| 101 | button | Full workbook <span aria-hidden="true">↗</span> | {onOpenWorkbook} |

## src/components/FormDialog.tsx

0 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |

## src/components/GoogleMapTools.tsx

3 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 19 | a | {'View ' + formatted + ' in Google Maps'} | {mapUrl} |
| 20 | a | {'Get driving directions to ' + formatted} | {directions} |
| 21 | button | {showMap ? 'Hide map' : 'Show map here'} | {() => setShowMap(v => !v)} |

## src/components/InvoiceDetail.tsx

19 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 66 | button | Back to invoices | {onBack} |
| 74 | button | ← Invoices | {onBack} |
| 82 | button | Mark sent manually | {markSent} |
| 83 | button | Void invoice | {voidInvoice} |
| 84 | button | Schedule reminder | {()=>setShowReminder(true)} |
| 85 | button | Record payment | {()=>setShowPayment(true)} |
| 86 | button | Print / Save PDF | {()=>window.print()} |
| 98 | a | Pay with {paymentProviders.find(p=>p.id===link.provider)?.name} | {link.url} |
| 108 | button | "Close" | {()=>setShowPayment(false)} |
| 108 | input | "number" | {e=>setAmount(e.target.value)} |
| 108 | select | <option value="cash">Cash</option> <option value="check">Check</option> <option value="card">Card</option> <option value="ach">ACH</option>  | {e=>setMethod(e.target.value as typeof method)} |
| 108 | input | Associated label | {e=>setPaymentNote(e.target.value)} |
| 108 | button | Cancel | {()=>setShowPayment(false)} |
| 108 | button | {busy?'Saving…':'Record payment'} | Form submit |
| 109 | button | "Close" | {()=>setShowReminder(false)} |
| 109 | input | "datetime-local" | {e=>setReminderAt(e.target.value)} |
| 109 | textarea | Associated label | {e=>setReminderNote(e.target.value)} |
| 109 | button | Cancel | {()=>setShowReminder(false)} |
| 109 | button | {busy?'Saving…':'Schedule reminder'} | Form submit |

## src/components/InvoiceEmailButton.tsx

4 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 62 | button | Email customer | {() => { setConfirm(true); setMessage('') }} |
| 71 | button | Cancel | {() => setConfirm(false)} |
| 71 | button | {busy ? 'Sending…' : 'Send invoice'} | {send} |
| 72 | button | Start a separate send instead | {startSeparateSend} |

## src/components/JobDetailsDialog.tsx

4 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 14 | button | Close | {onClose} |
| 14 | textarea | "Scope, materials to bring, access instructions, and updates…" | {e=>{setNotes(e.target.value);setNotice('')}} |
| 14 | button | {busy?'Saving…':'Save job details'} | Form submit |
| 14 | summary | Photos and expenses | Native control |

## src/components/PasswordRecovery.tsx

4 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 39 | button | Return to Finviant Office | {onDone} |
| 42 | input | "password" | {e => setPassword(e.target.value)} |
| 43 | input | "password" | {e => setConfirmation(e.target.value)} |
| 44 | button | {busy ? 'Updating…' : 'Update password'} | Form submit |

## src/components/PaymentOptionsFields.tsx

4 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 6 | summary | How customers can pay | Native control |
| 7 | input | "checkbox" | {e=>onChange({...value,payment_links:e.target.checked?[...value.payment_links,{provider:p.id,url:''}]:value.payment_links.filter(l=>l.provider!==p.id)})} |
| 7 | input | {p.example} | {e=>onChange({...value,payment_links:value.payment_links.map(l=>l.provider===p.id?{...l,url:e.target.value.trim()}:l)})} |
| 8 | textarea | "Cash, check, bank transfer, or instructions for your payment link" | {e=>onChange({...value,payment_instructions:e.target.value})} |

## src/components/PlanSelection.tsx

3 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 30 | a | <span className="marketing-logo"><img src="/finviant-mark.svg" alt="" /></span> <strong>Finviant<span className="brand-dot">.</span></strong | "/" |
| 31 | button | Sign out | {onSignOut} |
| 41 | button |  {busy ? 'Opening your test workspace…' : 'Continue to private testing'} <span aria-hidden="true">↗</span>  | {() => void continueToTesting()} |

## src/components/PrivateBetaNotice.tsx

0 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |

## src/components/QuickInvoiceReview.tsx

8 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 94 | select |  <option value="">Create a new customer</option> {customers.map(customer => <option value={customer.id} key={customer.id}>{customerLabel(cus | {event => { setCustomerId(event.target.value); setError('') }} |
| 100 | input | "Customer or business name" | {event => setCustomerName(event.target.value)} |
| 103 | input | "e.g. Replace bathroom faucet" | {event => setDescription(event.target.value)} |
| 107 | input | "number" | {event => setAmount(event.target.value)} |
| 110 | input | "number" | {event => setTaxRate(event.target.value)} |
| 114 | input | "date" | {event => setDueDate(event.target.value)} |
| 119 | button | Back | {onCancel} |
| 120 | button | {busy ? 'Saving draft…' : 'Save draft invoice'} | Form submit |

## src/components/RecordListControls.tsx

3 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 13 | input | "Customer, number, date, or status" | {e => list.setSearch(e.target.value)} |
| 14 | button | Previous | {() => list.setPage(list.page - 1)} |
| 14 | button | Next | {() => list.setPage(list.page + 1)} |

## src/components/RecordResources.tsx

13 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 68 | button | Refresh photos &amp; expenses | {() => { setError(''); setVersion(v => v + 1) }} |
| 72 | input | "Add pictures" | {event => { const files = Array.from(event.target.files // []); if (files.length) void upload(files) }} |
| 75 | a | <img src={photo.url} alt={photo.file_name} loading="lazy" /> | {photo.url} |
| 77 | button | {'Remove picture ${photo.file_name}'} | {() => { if (window.confirm('Remove this picture from the record?')) void run(() => removeRecordPhoto(business.id, photo), 'Picture removed.') }} |
| 79 | button | {showExpense ? 'Close expense form' : 'Add expense'} | {() => setShowExpense(value => !value)} |
| 82 | input | "date" | {e => setForm({ ...form, date: e.target.value })} |
| 83 | input | "number" | {e => setForm({ ...form, amount: e.target.value })} |
| 84 | select | {['Materials', 'Labor', 'Equipment', 'Travel', 'Other'].map(category => <option key={category}>{category}</option>)} | {e => setForm({ ...form, category: e.target.value })} |
| 85 | input | "Supplies, subcontractor, mileage…" | {e => setForm({ ...form, description: e.target.value })} |
| 86 | button | Cancel | {() => setShowExpense(false)} |
| 86 | button | Save expense | Form submit |
| 88 | button | {'Remove expense ${expense.description}'} | {() => { if (window.confirm('Remove this expense from the record and Financial Performance?')) void run(() => removeManualEntry(business.id, expense.id), 'Expense removed.') }} |
| 97 | button | Close | {onClose} |

## src/components/ServicePicker.tsx

4 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 27 | input | "radio" | {() => selectPlan(plan.id)} |
| 38 | input | "checkbox" | {event => toggleService(service.id, event.target.checked)} |
| 52 | input | "checkbox" | {event => toggleService(assistant.id, event.target.checked)} |
| 71 | input | "checkbox" | {event => toggleService(addon.id, event.target.checked)} |

## src/components/VoiceAssistant.tsx

8 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 348 | button | "Talk to Finviant Office" | {() => { setOpen(true); reset() }} |
| 350 | button | "Close" | {() => !recording && setOpen(false)} |
| 351 | button | <span className="record-orb">●</span> {recording ? 'Tap to stop' : voiceMode === 'checking' ? 'Checking voice…' : busy ? 'Working…' : 'Tap a | {toggleRecording} |
| 353 | button | Use iPhone keyboard microphone | {() => { textAreaRef.current?.focus(); setVoiceStatus('The text box is active. Tap the microphone on your iPhone keyboard, speak, and tap Done. Make sure text appears before you su |
| 356 | textarea | "Describe your invoice or request" | {(e) => { setText(e.target.value); setQuickInvoiceRequest(null); setAction(null); setResult(null) }} |
| 356 | button | {isQuickInvoiceCommand(text) ? 'Review invoice' : 'Send command'} | {submitText} |
| 358 | button | Cancel | {reject} |
| 358 | button | {busy ? 'Working…' : 'Confirm'} | {confirm} |

## src/components/WorkspaceBack.tsx

1 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 5 | button | ← Back | {back} |

## src/components/WorkspaceErrorBoundary.tsx

1 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 16 | button | Reload workspace | {() => window.location.reload()} |

## src/components/calendar/CalendarEntryDialog.tsx

11 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 37 | button | "Close calendar entry" | {close} |
| 39 | button | Event | {()=>setKind('event')} |
| 39 | button | Reminder | {()=>setKind('reminder')} |
| 39 | button | Use OpenAI assistant | {()=>{window.dispatchEvent(new CustomEvent('finviant-assistant-entry',{detail:{text:'Schedule a job on ${day} in ${zone}. ${title.trim()} ${notes.trim()}'.trim()}}));onClose()}} |
| 41 | input | "Customer visit, supply pickup, or follow-up" | {e=>setTitle(e.target.value)} |
| 42 | textarea | Associated label | {e=>setNotes(e.target.value)} |
| 43 | input | "datetime-local" | {e=>setStart(e.target.value)} |
| 44 | input | "datetime-local" | {e=>setEnd(e.target.value)} |
| 44 | select | <option value="">Choose team member</option> {team.map(w=><option key={w.id} value={w.id}>{w.label}{w.is_you?' (you)':''}</option>)} | {e=>setWorker(e.target.value)} |
| 47 | button | Back to calendar | {close} |
| 47 | button | {busy?'Saving…':entryId?'Save calendar entry':'Add '+kind} | Form submit |

## src/components/calendar/DailyCalendar.tsx

12 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 76 | button | {mode === 'week' ? 'Week' : 'Month'} | {() => setView(mode)} |
| 76 | button | + Reminder | {onReminders} |
| 76 | button | + Add entry | {()=>setEntry({day})} |
| 78 | select | <option value="all">Everyone</option> {team.map(item=><option value={item.id} key={item.id}>{item.is_you?'My schedule · ':''}{item.label}</o | {e=>setWorker(e.target.value)} |
| 80 | button | {'Previous ${view}'} | {() => setDay(selected.minus(view === 'week' ? { weeks: 1 } : { months: 1 }).toISODate()!)} |
| 80 | button | {'Next ${view}'} | {() => setDay(selected.plus(view === 'week' ? { weeks: 1 } : { months: 1 }).toISODate()!)} |
| 86 | button | {'${date.toLocaleString(DateTime.DATE_FULL)}${agenda ? ', ${items.length} scheduled ${items.length === 1 ? 'item' : 'items'}' : ''}'} | {() => {setDay(dateKey);if(business.role!=='viewer')setEntry({day:dateKey})}} |
| 93 | button | Retry | {() => setVersion(value => value + 1)} |
| 99 | a |  <time>{DateTime.fromISO(item.starts_at).setZone(zone).toFormat('h:mm a')}</time> <span><strong>{item.title}</strong><small>{DateTime.fromIS | {event=>{if(item.job_id){event.preventDefault();setJobId(item.job_id);return}if(item.source_key.startsWith('appointment:')&&!item.job_id&&item.document_kind==='work'){event.prevent |
| 103 | button | {showAllWork ? 'Show fewer scheduled items' : 'Show all ${work.length} scheduled items'} | {() => setShowAllWork(value => !value)} |
| 106 | button | {'Complete ${item.note // 'reminder'}'} | {() => void complete(item.id)} |
| 107 | button | {showAllReminders ? 'Show fewer reminders' : 'Show all ${reminders.length} reminders'} | {() => setShowAllReminders(value => !value)} |

## src/components/calendar/DocumentSchedule.tsx

7 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 132 | summary | Schedule this {kind}  | Native control |
| 145 | input | Associated label | {(e) => setTitle(e.target.value)} |
| 154 | textarea | Associated label | {(e) => setDescription(e.target.value)} |
| 163 | input | "datetime-local" | {(e) => setStart(e.target.value)} |
| 172 | input | "datetime-local" | {(e) => setEnd(e.target.value)} |
| 182 | select |  <option value="scheduled"> Scheduled — publish when auto-sync is on </option> {kind === "estimate" && ( <option value="planned">Planned — p | {(e) => setState(e.target.value)} |
| 198 | button |  {busy ? "Saving…" : "Save schedule"}  | Form submit |

## src/components/calendar/IntegrationSettings.tsx

8 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 104 | select |  {!calendars.some((c) => c.id === calendarId) && ( <option value={calendarId}>{integration.calendar_name}</option> )} {calendars.map((c) =>  | {(e) => setCalendarId(e.target.value)} |
| 121 | input | "checkbox" | {(e) => setEnabled(e.target.checked)} |
| 136 | button |  {busy ? "Saving…" : "Save calendar settings"}  | {() => void save()} |
| 143 | button | Disconnect  | {() =>                 void run(async () => {                   await calendarRequest("disconnect", businessId, "DELETE", {                     integrationId: integration.id,       |
| 156 | button | Retry sync  | {() =>                 void run(async () => {                   await calendarRequest("retry", businessId, "POST", {                     integrationId: integration.id,              |
| 185 | button |  {integration?.state === "reconnect_required" ? "Reconnect" : 'Connect ${name}'}  | {() => void connect()} |
| 212 | button | Erase connection; keep remote events  | {() =>                 void run(async () => {                   await calendarRequest("disconnect", businessId, "DELETE", {                     integrationId: integration.id,       |
| 284 | button | Retry  | {() => setVersion((v) => v + 1)} |

## src/components/scheduling/DispatchJobDialog.tsx

6 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 13 | button | "Close crew scheduling" | {onClose} |
| 13 | input | "datetime-local" | {e=>{setStart(e.target.value);if(e.target.value)setEnd(DateTime.fromISO(e.target.value,{zone}).plus({minutes:duration}).toFormat("yyyy-MM-dd'T'HH:mm"))}} |
| 13 | input | "datetime-local" | {e=>setEnd(e.target.value)} |
| 13 | input | "checkbox" | {e=>setWorkers(value=>e.target.checked?[...value,w.id]:value.filter(id=>id!==w.id))} |
| 13 | button | Cancel | {onClose} |
| 13 | button | {busy?'Checking & saving…':'Check availability & save'} | {()=>void save()} |

## src/components/scheduling/QuickCustomer.tsx

6 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 19 | button | + Add customer without leaving this draft | {()=>setOpen(true)} |
| 20 | input | Associated label | {e=>setName(e.target.value)} |
| 20 | input | "email" | {e=>setEmail(e.target.value)} |
| 20 | input | "tel" | {e=>setPhone(e.target.value)} |
| 20 | button | Cancel new customer | {()=>setOpen(false)} |
| 20 | button | {busy?'Adding customer…':'Add & select customer'} | {()=>void save()} |

## src/components/scheduling/ScheduleEstimateDialog.tsx

21 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 66 | button | "Close scheduling" | {close} |
| 68 | summary | Approved scope | Native control |
| 71 | button | Let customer choose | {()=>{setMode('offer');setApproved(false)}} |
| 71 | button | Time already agreed | {()=>{setMode('book');setApproved(false)}} |
| 73 | input | Associated label | {e=>{setTitle(e.target.value);setApproved(false)}} |
| 74 | select | <option value="">Confirm address with customer</option> {context.properties?.map(p=><option value={p.id} key={p.id}>{p.label?'${p.label} · ' | {e=>{setSite(e.target.value);setApproved(false)}} |
| 75 | select | {[15,30,45,60,90,120,180,240,360,480,600,720].map(n=><option key={n} value={n}>{n<60?'${n} minutes':'${n/60} hours'}</option>)} | {e=>setDuration(Number(e.target.value))} |
| 76 | input | "date" | {e=>setFrom(e.target.value)} |
| 78 | input | "checkbox" | {e=>{setWorkers(value=>e.target.checked?[...value,w.id]:value.filter(id=>id!==w.id));setApproved(false)}} |
| 80 | button | Refresh times | {()=>setRefresh(n=>n+1)} |
| 82 | input | {mode==='book'?'radio':'checkbox'} | {()=>toggle(slot.starts_at)} |
| 83 | textarea | Associated label | {e=>{setNote(e.target.value);setApproved(false)}} |
| 85 | input | "checkbox" | {e=>setApproved(e.target.checked)} |
| 86 | button | Cancel | {close} |
| 87 | button | {busy?'Saving…':'Approve & create invitation'} | {()=>void save(false)} |
| 87 | button | Approve & email customer | {()=>void save(true)} |
| 87 | button | {busy?'Booking…':'Confirm booking'} | {()=>void save(false)} |
| 91 | input | Associated label | Native control |
| 91 | button | Copy invitation | {()=>{void navigator.clipboard.writeText(created.url).then(()=>setNotice('Invitation link copied.')).catch(()=>setError('Select the link above and copy it.'))}} |
| 91 | button | {busy?'Sending…':'Approve & send email'} | {()=>void save(true)} |
| 94 | button | Done | {close} |

## src/components/scheduling/SchedulingSettings.tsx

13 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 17 | input | "checkbox" | {e=>setContext({...context,preferences:{...p,work_days:e.target.checked?[...p.work_days,n+1]:p.work_days.filter(day=>day!==n+1)}})} |
| 18 | input | "time" | {e=>setContext({...context,preferences:{...p,start_minutes:minutes(e.target.value)}})} |
| 18 | input | "time" | {e=>setContext({...context,preferences:{...p,end_minutes:minutes(e.target.value)}})} |
| 18 | input | "number" | {e=>setContext({...context,preferences:{...p,duration_minutes:Number(e.target.value)}})} |
| 18 | input | "number" | {e=>setContext({...context,preferences:{...p,buffer_minutes:Number(e.target.value)}})} |
| 18 | input | "number" | {e=>setContext({...context,preferences:{...p,notice_hours:Number(e.target.value)}})} |
| 19 | button | Save scheduling preferences | {()=>void run(()=>saveSchedulingPreferences(business.id,p),'Working hours saved.')} |
| 20 | select | {context.team.map(w=><option key={w.id} value={w.id}>{w.label}{w.is_you?' (you)':''}</option>)} | {e=>setWorker(e.target.value)} |
| 20 | input | "Time off, appointment, outside work…" | {e=>setNote(e.target.value)} |
| 20 | input | "datetime-local" | {e=>setStart(e.target.value)} |
| 20 | input | "datetime-local" | {e=>setEnd(e.target.value)} |
| 20 | button | Block time | {()=>void run(()=>manageTimeOff(business.id,worker,localInstant(start,zone),localInstant(end,zone),note),'Time blocked for this team member.')} |
| 20 | button | Remove | {()=>void run(()=>manageTimeOff(business.id,t.user_id,t.starts_at,t.ends_at,t.note,t.id),'Blocked time removed.')} |

## src/components/scheduling/WorkflowNextSteps.tsx

6 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 22 | button | Retry next steps | {()=>setVersion(v=>v+1)} |
| 23 | button | {row.offer?.status==='approved'?'Review times':'Schedule job'} | {()=>setEstimate(row.id)} |
| 24 | a | Review invoice | {'/?view=invoices&document=${encodeURIComponent(row.invoice_id)}'} |
| 24 | a | Add charges & invoice | {'/?view=invoices&job=${encodeURIComponent(row.id)}'} |
| 24 | button | {busy===row.id?'Preparing…':'Prepare invoice draft'} | {()=>void prepare(row.id)} |
| 25 | button | {showAll?'Show fewer next steps':'Show more next steps'} | {()=>setShowAll(value=>!value)} |

## src/components/settings/DocumentSettings.tsx

6 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 86 | button | Reload settings  | {() => window.location.reload()} |
| 106 | input | "color" | {(e) =>                 setBrand({ ...brand, document_accent: e.target.value })               } |
| 116 | input | "file" | {(e) => setLogo(e.target.files?.[0] // null)} |
| 124 | textarea | Associated label | {(e) =>                 setBrand({ ...brand, document_footer: e.target.value })               } |
| 149 | input | "number" | {(e) =>               setDefaultTax(Number(e.target.value))             } |
| 177 | button |  {busy ? "Saving…" : "Save document setup"}  | Form submit |

## src/components/settings/PaymentSettings.tsx

6 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 44 | button | Reload settings | {() => window.location.reload()} |
| 60 | input | "checkbox" | {(e) =>                     setValue({                       ...value,                       payment_links: e.target.checked                         ? [...value.payment_links, { pr |
| 79 | input | {p.example} | {(e) =>                       setValue({                         ...value,                         payment_links: value.payment_links.map((l) =>                           l.provide |
| 103 | textarea | "Please include your invoice number with payment." | {(e) =>               setValue({ ...value, payment_instructions: e.target.value })             } |
| 123 | input | "number" | {(e) =>               setValue({                 ...value,                 pricing_adjustment_percent: Number(e.target.value),               })             } |
| 152 | button | {busy ? "Saving…" : submitLabel} | Form submit |

## src/components/settings/SubscriptionSettings.tsx

4 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 45 | button | Retry status  | {() => void refresh()} |
| 67 | button | Cancel subscription  | {() => setConfirm(true)} |
| 93 | button |  {busy ? "Confirming…" : "Confirm cancellation"}  | {() => void cancel()} |
| 100 | button | Keep subscription  | {() => setConfirm(false)} |

## src/components/settings/TeamSettings.tsx

13 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 36 | input | "checkbox" | {(e) =>               onChange(                 e.target.checked                   ? [...modules, m.id]                   : modules.filter((x) => x !== m.id),               )       |
| 186 | input | Associated label | Native control |
| 192 | button | Copy link  | {() =>               void navigator.clipboard                 .writeText(inviteUrl)                 .then(() => setNotice("Invitation link copied."))                 .catch(() =>   |
| 223 | button | Edit access  | {() =>                   setEditing({                     ...m,                     role: m.role === "admin" ? "office" : m.role,                   })                 } |
| 235 | button | Remove  | {() => void manage(m.user_id, "remove")} |
| 251 | select |  <option value="office">Office staff</option> <option value="technician">Field staff</option> <option value="viewer">Read-only staff</option | {(e) =>                 setEditing({                   ...editing,                   role: e.target.value,                   access_modules:                     e.target.value ===  |
| 278 | button | Save access  | {() =>                 void manage(                   editing.user_id,                   "update",                   editing.role as TeamRole,                   editing.access_modu |
| 292 | button | Cancel  | {() => setEditing(null)} |
| 313 | button | Resend  | {async () => {                     setBusy(true);                     setError("");                     try {                       const r = await inviteMember(                    |
| 343 | button | Cancel invitation  | {() => void manage(i.id, "revoke")} |
| 372 | input | "email" | {(e) => setEmail(e.target.value)} |
| 383 | select |  <option value="technician">Field staff</option> <option value="office">Office staff</option> <option value="viewer">Read-only staff</option | {(e) => changeRole(e.target.value as TeamRole)} |
| 400 | button |  {busy ? "Saving…" : "Send invitation"}  | Form submit |

## src/main.tsx

0 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |

## src/pages/BookkeepingPage.tsx

21 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 199 | button | + Add expense or income | {() => { retryId.current = null; setNewEntry(true); setSource('velnu') }} |
| 202 | button | Finviant Office workbook | {() => setSource('velnu')} |
| 203 | button | QuickBooks Online | {() => setSource('quickbooks')} |
| 206 | select |  <option value="30">Last 30 days</option> <option value="90">Last 90 days</option> <option value="all">All available entries</option>  | {e => setRange(e.target.value as RangeChoice)} |
| 209 | button | Download CSV | {() => exportCsv(visible, source)} |
| 223 | button | {busy ? 'Working…' : 'Sync transactions'} | {synchronize} |
| 224 | button | Disconnect | {disconnect} |
| 228 | input | "checkbox" | {e => setCostsAcknowledged(e.target.checked)} |
| 230 | button | Connect QuickBooks Online | {connect} |
| 233 | a | Review Intuit plans and fees | "https://quickbooks.intuit.com/pricing/" |
| 248 | button | Retry loading workbook | {() => void refresh()} |
| 257 | button | Delete | {() => void deleteEntry(row)} |
| 262 | button | "Close form" | {() => setNewEntry(false)} |
| 265 | select |  <option value="expense">Expense / money spent</option> <option value="income">Other income / money received</option> | {e => { setDirection(e.target.value as EntryDirection); setCategory(e.target.value === 'income' ? 'Other received income' : 'Materials & supplies') }} |
| 267 | input | "Transaction date" | {e => setEntryDate(e.target.value)} |
| 268 | input | "Amount in USD" | {e => setAmount(e.target.value)} |
| 269 | select |  {(direction === 'expense' ? ['Materials & supplies','Equipment & tools','Fuel & travel','Contractor payments','Software & subscriptions','O | {e => setCategory(e.target.value)} |
| 273 | input | "Description" | {e => setDescription(e.target.value)} |
| 274 | textarea | "Notes" | {e => setNotes(e.target.value)} |
| 276 | button | Cancel | {() => setNewEntry(false)} |
| 277 | button | {busy ? 'Saving…' : 'Save entry'} | Form submit |

## src/pages/ChangeOrdersPage.tsx

22 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 141 | button | ← Back to {context?.documentType // 'document'} | {onBack} |
| 144 | button | + New change order | {() => setShowForm(true)} |
| 160 | button | Mark sent manually | {() => changeStatus(order.id, 'sent')} |
| 161 | button | Void | {() => changeStatus(order.id, 'void')} |
| 162 | button | Email customer | {() => emailForApproval(order)} |
| 163 | button | Get customer approval link | {() => shareForApproval(order)} |
| 169 | button | "Close" | {() => { if(!saving.current){setShowForm(false); resetForm()} }} |
| 172 | summary | Original scope and prices | Native control |
| 173 | select | <option value="">Choose job…</option> {availableJobs.map((job) => <option value={job.id} key={job.id}>{customerName(jobCustomer(job))} — {jo | {(e) => setJobId(e.target.value)} |
| 174 | input | "Add two recessed lights" | {(e) => setTitle(e.target.value)} |
| 175 | textarea | "Describe exactly what is being added, removed, or changed." | {(e) => setDescription(e.target.value)} |
| 176 | input | "Customer requested" | {(e) => setReason(e.target.value)} |
| 177 | input | "number" | {(e) => setScheduleImpactDays(e.target.value)} |
| 178 | input | "Adds one working day to completion." | {(e) => setScheduleNote(e.target.value)} |
| 180 | button | + Add line | {() => setLines([...lines, blankLine()])} |
| 180 | input | "Description" | {(e) => setLines(lines.map((item, i) => i === index ? { ...item, description: e.target.value } : item))} |
| 180 | input | "Qty" | {(e) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: e.target.value } : item))} |
| 180 | input | "Unit price" | {(e) => setLines(lines.map((item, i) => i === index ? { ...item, unit_price: e.target.value } : item))} |
| 180 | input | "Tax %" | {(e) => setLines(lines.map((item, i) => i === index ? { ...item, tax_rate: e.target.value } : item))} |
| 180 | button | "Remove line item" | {() => setLines(lines.length === 1 ? [blankLine()] : lines.filter((_, i) => i !== index))} |
| 183 | button | Cancel | {() => { if(!saving.current){setShowForm(false); resetForm()} }} |
| 183 | button | {busy ? 'Saving…' : 'Create change order'} | Form submit |

## src/pages/CustomerApprovalPage.tsx

4 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 89 | input | "Your full name" | {(e) => setTypedName(e.target.value)} |
| 91 | input | "checkbox" | {(e) => { setAgreedToTerms(e.target.checked); setError('') }} |
| 95 | button | Decline | {() => submit('declined')} |
| 95 | button | {busy ? 'Recording…' : data.document_type === 'estimate' ? 'Accept estimate and agree to terms' : 'Approve change order'} | {() => submit('approved')} |

## src/pages/CustomerBookingPage.tsx

5 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 30 | button | Add to calendar (.ics) | {download} |
| 33 | input | "radio" | {()=>setSlot(item.id)} |
| 33 | input | Associated label | {e=>setName(e.target.value)} |
| 33 | button | {busy?'Confirming…':'Confirm this appointment'} | {()=>void confirm()} |
| 36 | button | Refresh appointment times | {()=>setVersion(n=>n+1)} |

## src/pages/CustomersPage.tsx

12 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 71 | button | Import contacts | {()=>setShowImport(true)} |
| 72 | button | + New customer | {() => setShowForm(true)} |
| 74 | input | "Search customers" | {(e) => setQuery(e.target.value)} |
| 80 | button |  <div className="avatar">{name.charAt(0).toUpperCase()}</div> <div className="row-main"><strong>{name}</strong><span>{customer.company && na | {() => setSelectedCustomerId(customer.id)} |
| 90 | button | "Close" | {() => setShowForm(false)} |
| 92 | input | Associated label | {(e) => setForm({ ...form, first_name: e.target.value })} |
| 93 | input | Associated label | {(e) => setForm({ ...form, last_name: e.target.value })} |
| 94 | input | Associated label | {(e) => setForm({ ...form, company: e.target.value })} |
| 95 | input | Associated label | {(e) => setForm({ ...form, phone: e.target.value })} |
| 96 | input | "email" | {(e) => setForm({ ...form, email: e.target.value })} |
| 98 | button | Cancel | {() => setShowForm(false)} |
| 98 | button | {busy ? 'Saving…' : 'Save customer'} | Form submit |

## src/pages/DashboardPage.tsx

5 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 100 | a | + New invoice | "/?view=invoices&new=1" |
| 100 | a | + New estimate | "/?view=estimates&new=1" |
| 100 | a | + New job | "/?view=work&new=1" |
| 103 | button | {loading ? 'Refreshing…' : 'Refresh'} | {() => { setRefreshVersion(value => value + 1); void refresh(true) }} |
| 108 | button | Set up company | {onSetup} |

## src/pages/EstimatesPage.tsx

33 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 211 | button | + New estimate | {() => { resetForm(); setShowForm(true) }} |
| 220 | button | <strong>{estimate.estimate_number // 'Draft estimate'}</strong> <span>{customerName(customer)} · {new Date(estimate.issue_date + 'T00:00:00' | {() => openPreview(estimate)} |
| 223 | button | {'Photos and expenses for ${estimate.estimate_number // 'estimate'}'} | {() => setResourceEstimate(estimate)} |
| 224 | button | Preview / Print | {() => openPreview(estimate)} |
| 226 | button | Mark sent manually | {() => changeStatus(estimate.id, 'sent')} |
| 227 | button | Record acceptance | {() => changeStatus(estimate.id, 'accepted')} |
| 228 | button | Record decline | {() => changeStatus(estimate.id, 'declined')} |
| 229 | button | Expire | {() => changeStatus(estimate.id, 'expired')} |
| 230 | button | Email customer | {() => emailForApproval(estimate)} |
| 231 | button | Get customer approval link | {() => shareForApproval(estimate)} |
| 232 | button | Create invoice | {() => { setError(''); setNotice(''); setConvertTarget(estimate) }} |
| 233 | button | Schedule job | {()=>setScheduleTarget(estimate)} |
| 234 | a | Open linked job | {'/?view=work&document=${encodeURIComponent(estimate.job_id)}'} |
| 242 | button | "Close" | {() => { setShowForm(false); resetForm() }} |
| 244 | input | "date" | {e => setIssueDate(e.target.value)} |
| 244 | input | "date" | {(e) => setExpiresOn(e.target.value)} |
| 244 | input | Associated label | {(e) => setNotes(e.target.value)} |
| 246 | textarea | "For example: Estimate valid for 14 days. A deposit is due before work begins." | {e => setCustomerTerms(e.target.value)} |
| 247 | button | + Add line | {() => setLines([...lines, newLine()])} |
| 247 | input | "Description" | {(e) => setLines(lines.map((item, i) => i === index ? { ...item, description: e.target.value } : item))} |
| 247 | input | "Qty" | {(e) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: e.target.value } : item))} |
| 247 | input | "Unit price" | {(e) => setLines(lines.map((item, i) => i === index ? { ...item, unit_price: e.target.value } : item))} |
| 247 | input | "Tax rate (%)" | {(e) => setLines(lines.map((item, i) => i === index ? { ...item, tax_rate: e.target.value } : item))} |
| 247 | button | "Remove line item" | {() => setLines(lines.length === 1 ? [newLine()] : lines.filter((_, i) => i !== index))} |
| 250 | button | Cancel | {() => { setShowForm(false); resetForm() }} |
| 250 | button | {busy ? 'Saving…' : 'Create estimate'} | Form submit |
| 254 | button | "Close" | {() => { setConvertTarget(null); setConvertDueDate(''); setError('') }} |
| 256 | input | "date" | {(e) => setConvertDueDate(e.target.value)} |
| 256 | button | Cancel | {() => { setConvertTarget(null); setConvertDueDate(''); setError('') }} |
| 256 | button | {busy ? 'Creating…' : 'Create invoice'} | Form submit |
| 264 | button | "Close preview" | {() => {setPreviewTarget(null);history.replaceState(history.state,'','/?view=estimates')}} |
| 268 | button | Print / Save PDF | {() => window.print()} |
| 269 | button | Close | {() => {setPreviewTarget(null);history.replaceState(history.state,'','/?view=estimates')}} |

## src/pages/InstallPage.tsx

6 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 4 | a | <span className="marketing-logo"><img src="/finviant-mark.svg" alt="" /></span> <strong>Finviant<span className="brand-dot">.</span></strong | "/" |
| 5 | a | Home | "/" |
| 5 | a | Services | "/services" |
| 5 | a | Sign in | "/auth?mode=signin" |
| 11 | a | Open Finviant Office web app <span>↗</span> | "/auth?mode=signin" |
| 11 | a | Create a free beta account <span>↗</span> | "/auth?mode=signup" |

## src/pages/InvoicesPage.tsx

15 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 123 | button | + New invoice | {() => { resetForm(); setShowForm(true) }} |
| 130 | button | <div className="row-main"><strong>{invoice.invoice_number // 'Draft invoice'}</strong><span>{customerName(customer)} · {new Date(invoice.iss | {() => setSelectedInvoiceId(invoice.id)} |
| 137 | button | "Close" | {() => { setShowForm(false); resetForm() }} |
| 139 | input | "date" | {e => setIssueDate(e.target.value)} |
| 139 | input | "date" | {(e) => setDueDate(e.target.value)} |
| 139 | input | Associated label | {(e) => setNotes(e.target.value)} |
| 141 | button | + Add line | {() => setLines([...lines, newLine()])} |
| 141 | input | "Description" | {(e) => setLines(lines.map((item, i) => i === index ? { ...item, description: e.target.value } : item))} |
| 141 | input | "Qty" | {(e) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: e.target.value } : item))} |
| 141 | input | "Unit price" | {(e) => setLines(lines.map((item, i) => i === index ? { ...item, unit_price: e.target.value } : item))} |
| 141 | input | "Tax rate (%)" | {(e) => setLines(lines.map((item, i) => i === index ? { ...item, tax_rate: e.target.value } : item))} |
| 141 | button | "Remove line item" | {() => setLines(lines.length === 1 ? [newLine()] : lines.filter((_, i) => i !== index))} |
| 142 | input | "checkbox" | {e=>setAdjustPrices(e.target.checked)} |
| 145 | button | Cancel | {() => { setShowForm(false); resetForm() }} |
| 145 | button | {busy ? 'Saving…' : 'Create invoice'} | Form submit |

## src/pages/JobsPage.tsx

19 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 120 | button | Refresh | {() => void refresh().catch(err => setError(readableError(err, 'Unable to load jobs')))} |
| 120 | button | + New job | {() => setShowForm(true)} |
| 123 | button | {item === 'current' ? 'Current' : item === 'upcoming' ? 'Upcoming' : 'History'} {!loading && !error && <span>{grouped[item].length}</span>} | {() => { setGroup(item); recordList.setPage(0) }} |
| 124 | select | <option value="all">Everyone</option> {team.map(w=><option key={w.id} value={w.id}>{w.is_you?'My jobs · ':''}{w.label}</option>)} | {e=>{setWorkerFilter(e.target.value);recordList.setPage(0)}} |
| 133 | button | {job.title} | {()=>setDetailsJob(job.id)} |
| 134 | button | Job details | {()=>setDetailsJob(job.id)} |
| 134 | button | {'Schedule and crew for ${job.title}'} | {()=>setDispatch(job)} |
| 134 | button | {'Photos and expenses for ${job.title}'} | {() => setResourceJob(job)} |
| 134 | button | {'Add reminder for ${job.title}'} | {() => onCreateReminder(job)} |
| 134 | select | {'Status for ${job.title}'} | {(e) => changeStatus(job.id, e.target.value as any)} |
| 144 | button | "Close" | {() => setShowForm(false)} |
| 146 | select | <option value="">Choose customer…</option> {customers.map((customer) => <option value={customer.id} key={customer.id}>{[customer.first_name, | {(e) => setForm({ ...form, customer_id: e.target.value, property_id: '' })} |
| 149 | input | "Replace water heater" | {(e) => setForm({ ...form, title: e.target.value })} |
| 150 | textarea | Associated label | {(e) => setForm({ ...form, description: e.target.value })} |
| 151 | input | "datetime-local" | {(e) => setForm({ ...form, scheduled_start: e.target.value })} |
| 152 | select | {[30,60,90,120,180,240,360,480,720].map(n=><option key={n} value={n}>{n<60?'${n} minutes':'${n/60} hours'}</option>)} | {e=>setNewDuration(Number(e.target.value))} |
| 152 | input | "checkbox" | {e=>setNewCrew(value=>e.target.checked?[...value,w.id]:value.filter(id=>id!==w.id))} |
| 153 | button | Cancel | {() => setShowForm(false)} |
| 153 | button | {busy ? 'Saving…' : 'Save job'} | Form submit |

## src/pages/JobsSchedulePage.tsx

0 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |

## src/pages/LandingPage.tsx

18 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 22 | a | "Finviant Office home" | "/" |
| 23 | a | Features | "#features" |
| 23 | a | AI assistant | "#ai-assistant" |
| 23 | a | How it works | "#how-it-works" |
| 24 | a | Sign in | "/auth?mode=signin" |
| 24 | a | Join private beta <span aria-hidden="true">↗</span> | "/auth?mode=signup" |
| 34 | a | Get started with Finviant Office <span>↗</span> | "/auth?mode=signup" |
| 34 | a | Sign in to your test workspace <span aria-hidden="true">↗</span> | "/auth?mode=signin" |
| 35 | a | add it to your Home Screen | "/install" |
| 84 | a | Explore the private beta <span>↗</span> | "/auth?mode=signup" |
| 96 | button | <span>{item.q}</span> <b>{openFaq===i?'−':'+'}</b> | {()=>setOpenFaq(openFaq===i?null:i)} |
| 97 | a | Join the private beta <span>↗</span> | "/auth?mode=signup" |
| 99 | a | <span className="marketing-logo"><img src="/finviant-mark.svg" alt="" /></span> <strong>Finviant<span className="brand-dot">.</span></strong | "/" |
| 99 | a | Features | "#features" |
| 99 | a | AI assistant | "#ai-assistant" |
| 99 | a | Use the web app | "/install" |
| 99 | a | Sign in | "/auth?mode=signin" |
| 99 | a | User agreement, AI and privacy | "/legal" |

## src/pages/LegalPage.tsx

7 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 5 | a | <span className="marketing-logo"><img src="/finviant-mark.svg" alt="" /></span> <strong>Finviant</strong> | "/" |
| 5 | a | Back to home | "/" |
| 11 | a | Business user terms | "#legal-terms" |
| 11 | a | Privacy and data handling | "#legal-privacy" |
| 17 | a | Business terms | "#legal-terms" |
| 17 | a | Privacy section | "#legal-privacy" |
| 17 | a | Sign in and choose a plan | "/auth?mode=signin&next=plans" |

## src/pages/LocationsPage.tsx

4 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 50 | button | Manage properties | {onCustomers} |
| 56 | button | Go to customers | {onCustomers} |
| 60 | input | "Search service locations" | {e => setQuery(e.target.value)} |
| 61 | button |  <span className="locations-marker" aria-hidden="true">⌖</span> <span><strong>{location.label // displayCustomer(location.customers?.[0])}</ | {() => setSelectedId(location.id)} |

## src/pages/PaymentsPage.tsx

9 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 58 | button | View financial performance | {onOpenWorkbook} |
| 58 | button | + Record payment | {() => setShowForm(true)} |
| 71 | button | "Close" | {() => { setShowForm(false); resetForm() }} |
| 73 | select | "Invoice" | {(e) => { const id = e.target.value; setInvoiceId(id); const inv = openInvoices.find((x) => x.id === id); if (inv) setAmount(String(inv.balance_due)) }} |
| 74 | input | "number" | {(e) => setAmount(e.target.value)} |
| 75 | select | <option value="cash">Cash</option> <option value="check">Check</option> <option value="card">Card</option> <option value="ach">ACH</option>  | {(e) => setMethod(e.target.value as typeof method)} |
| 76 | input | "Optional note" | {(e) => setNotes(e.target.value)} |
| 79 | button | Cancel | {() => { setShowForm(false); resetForm() }} |
| 79 | button | {busy ? 'Saving…' : 'Record payment'} | Form submit |

## src/pages/PlaceholderPage.tsx

0 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |

## src/pages/RemindersPage.tsx

11 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 112 | button | Refresh | {() => void refresh()} |
| 113 | button | + New reminder | {() => { setShowForm(true); setSuccess('') }} |
| 119 | textarea | "Call the customer to confirm access" | {event => setForm({ ...form, note: event.target.value })} |
| 120 | input | "datetime-local" | {event => setForm({ ...form, due: event.target.value })} |
| 121 | select | <option value="">No linked job</option> {jobs.map(job => <option value={job.id} key={job.id}>{job.title}</option>)} | {event => setForm({ ...form, jobId: event.target.value })} |
| 126 | button | Cancel | {closeForm} |
| 126 | button | {busy ? 'Saving…' : 'Save reminder'} | Form submit |
| 129 | button | {item === 'pending' ? 'Pending' : 'Completed'} | {() => { setStatus(item); setOffset(0); setSuccess('') }} |
| 135 | button | {'Mark ${reminder.note // 'reminder'} done'} | {() => void finish(reminder.id)} |
| 138 | button | Previous | {() => setOffset(Math.max(0, offset - REMINDER_PAGE_SIZE))} |
| 138 | button | Next | {() => setOffset(offset + REMINDER_PAGE_SIZE)} |

## src/pages/SchedulePage.tsx

10 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 118 | button | + Schedule work | {() => setShowForm(true)} |
| 121 | select | <option value="scheduled">Scheduled</option> <option value="confirmed">Confirmed</option> <option value="in_progress">In progress</option> < | {(e) => changeStatus(appointment.id, e.target.value)} |
| 124 | button | "Close" | {() => { setShowForm(false); resetForm() }} |
| 126 | select | <option value="">Choose customer…</option> {customers.map((customer) => <option value={customer.id} key={customer.id}>{name(customer)}</opti | {(e) => setForm({ ...form, customer_id: e.target.value, property_id: '' })} |
| 128 | input | "Replace garbage disposal" | {(e) => setForm({ ...form, title: e.target.value })} |
| 129 | input | "datetime-local" | {(e) => setForm({ ...form, starts_at: e.target.value })} |
| 130 | input | "datetime-local" | {(e) => setForm({ ...form, ends_at: e.target.value })} |
| 131 | textarea | Associated label | {(e) => setForm({ ...form, description: e.target.value })} |
| 133 | button | Cancel | {() => { setShowForm(false); resetForm() }} |
| 133 | button | {busy ? 'Saving…' : 'Schedule job'} | Form submit |

## src/pages/ServicesPage.tsx

6 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 10 | a | <span className="marketing-logo"><img src="/finviant-mark.svg" alt="" /></span> <strong>Finviant<span className="brand-dot">.</span></strong | "/" |
| 11 | a | Home | "/" |
| 11 | a | Use the app | "/install" |
| 11 | a | Sign in | "/auth?mode=signin" |
| 20 | button | Continue to account setup <span>↗</span> | {saveAndContinue} |
| 21 | a | Already have an account? Sign in and save choices | {()=>setPendingServiceInterests(selected)} |

## src/pages/SettingsPage.tsx

1 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 53 | button | {option.title} | {() => setSection(expanded ? null : option.id)} |

## src/pages/TeamInvitationPage.tsx

3 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |
| 77 | button |  {busy ? "Joining…" : "Accept invitation"}  | {() => void join()} |
| 84 | button | Use a different account  | {() => void supabase.auth.signOut()} |
| 90 | a | Leave invitation  | {() => sessionStorage.removeItem("finviant-team-invitation")} |

## src/pages/WorkspaceServicesPage.tsx

0 control definitions.

| Line | Control | Label/content | Handler/destination |
| --- | --- | --- | --- |

