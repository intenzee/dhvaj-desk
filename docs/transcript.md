# Dhvaj Desk — a run in the rooms

Exported from Switch with `npm run transcript` on 2026-11-06 15:08 IST. Every line below is what was
posted in the room, unedited: 🤖 an agent, 🧑 a person, 🧭 the kickoff from the Switch template,
🏛️ the portal's own account (its live posts, or a kickoff re-sent through it).
Figures, dates and names come from the demo firm in the Dhvaj Portal (all made up).

## #firm-ops

🧭 **template kickoff** · 2026-11-06 15:05 IST

> @dhvaj-desk this is #firm-ops. Post today's brief from the portal
> (firm_brief): overdue by client, due this week, and the risk tiles.

🤖 **dhvaj-desk** · 2026-11-06 15:06 IST

> **Brief: 6 Nov 2026**
> - **Overdue (33):** Bharat Textiles LLP 27, Sharma Traders 6. The oldest are Bharat's Apr 2026 items: Challan ITNS 281 (due 7 May), GSTR-1 (due 11 May), inward reconciliation (due 18 May).
> - **Due this week (4, none started, no reviewer set):** Challan ITNS 281 Oct, Bharat Textiles, **due 7 Nov** (Manager X) · GSTR-1 Oct, Bharat Textiles, due 11 Nov (Partner A) · GSTR-1 Oct, Sharma Traders, due 11 Nov (me) · ESI return H1 2026-27, Sharma Traders, due 11 Nov (me)
> - **Risk tiles:** missed 33 · due but not ready 4 · KYC not complete 12. Notices, appeals, receivables, unbilled, DSC, UDIN and approvals are all 0.
> - **KYC:** none of the 12 clients has complete KYC; all 12 are pending, including Bharat Textiles and Sharma Traders.
> - Nothing is waiting for review or partner sign-off.
> 
> [Today](http://localhost:3100/today) · [Overdue](http://localhost:3100/compliance?filter=overdue) · [Due soon](http://localhost:3100/compliance?filter=due-soon) · [KYC](http://localhost:3100/client-kyc?status=open)

## #compliance-desk

🧭 **template kickoff** · 2026-11-06 15:05 IST

> @dhvaj-desk this is #compliance-desk. Say in one line what you answer
> here, then list what is due in the next 7 days (due_list).

🤖 **dhvaj-desk** · 2026-11-06 15:06 IST

> Here I answer "what is due": the compliance calendar for every stream and client, overdue first. I also pass filings waiting on a client to the chaser and filings ready for review to the reviewer.
> 
> **Overdue first: 33 filings, none started**
> - **Bharat Textiles LLP**: 27 overdue, the oldest from Apr 2026 (Challan ITNS 281, due 7 May 2026). Its GSTR-1, inward reconciliation and GSTR-3B for Apr to Sep, monthly Challan ITNS 281 and Form 140 / 131/133 have not been started. [Oldest](http://localhost:3100/engagements/60f055f7-29bb-491c-b338-e80b6cc40128?tab=tds&fy=2026-27&p=2026-04)
> - **Sharma Traders**: 6 overdue. For Sep 2026: PTRC Form III, GSTR-1, ESI challan, ECR and inward reconciliation. For Oct 2026: PTRC Form III (due 31 Oct 2026). All assigned to me. [Oldest](http://localhost:3100/engagements/ae316ba3-bd0c-43fc-9f97-fb65420e8ccb?tab=payroll&fy=2026-27&gstin=27482130981P&p=2026-09)
> 
> **Due in the next 7 days (to 13 Nov 2026), all not started**
> 
> | Due | Form | Client | Period | Assignee |
> |---|---|---|---|---|
> | 7 Nov 2026 | [Challan ITNS 281](http://localhost:3100/engagements/60f055f7-29bb-491c-b338-e80b6cc40128?tab=tds&fy=2026-27&p=2026-10) | Bharat Textiles LLP | Oct 2026 | Manager X |
> | 11 Nov 2026 | [GSTR-1](http://localhost:3100/engagements/60f055f7-29bb-491c-b338-e80b6cc40128?tab=gst&fy=2026-27&gstin=27AABCT1234C1Z5&m=10&part=outward) | Bharat Textiles LLP | Oct 2026 | Partner A |
> | 11 Nov 2026 | [GSTR-1](http://localhost:3100/engagements/ae316ba3-bd0c-43fc-9f97-fb65420e8ccb?tab=gst&fy=2026-27&gstin=27AAHFS4821K1ZX&m=10&part=outward) | Sharma Traders | Oct 2026 | dhvaj-desk (agent) |
> | 11 Nov 2026 | [ESI return of contributions](http://localhost:3100/engagements/ae316ba3-bd0c-43fc-9f97-fb65420e8ccb?tab=payroll&fy=2026-27&gstin=31000482130001001&p=2026-27%3AH1) | Sharma Traders | H1 2026-27 | dhvaj-desk (agent) |
> 
> Ask for any client's full overdue list and I'll post it item by item.

## #client-chase

🧭 **template kickoff** · 2026-11-06 15:05 IST

> @dhvaj-chaser this is #client-chase. Say hello in one line and explain
> that nothing goes to a client until a person here says send.

🤖 **dhvaj-chaser** · 2026-11-06 15:05 IST

> Hello, I'm Dhvaj Chaser. I draft the portal's reminders to clients for documents the firm is still waiting on, and I post each draft here first. Nothing goes to a client until a person in this room replies *send*.

🏛️ **dhvaj-portal** · 2026-11-06 15:07 IST

> @dhvaj-chaser this is #client-chase. Say hello in one line and explain that nothing goes to a client until a person here says send.

🤖 **dhvaj-chaser** · 2026-11-06 15:07 IST

> Already said hello just above. To repeat the rule: no reminder goes to a client until a person here replies *send*. A yes from an agent doesn't count.

## #review-queue

🧭 **template kickoff** · 2026-11-06 15:05 IST

> @dhvaj-reviewer this is #review-queue. Check your To Review inbox
> (review_inbox) and say what is waiting.

🤖 **dhvaj-reviewer** · 2026-11-06 15:06 IST

> One filing is waiting for review: **Sharma Traders — GSTR-3B, Oct 2026**. Riya Kapoor prepared it and sent it on 5 Nov 2026. Due date is 20 Nov 2026 (internal date 17 Nov 2026, 14 days left). [Open filing](http://localhost:3100/engagements/ae316ba3-bd0c-43fc-9f97-fb65420e8ccb?tab=gst&fy=2026-27&gstin=27AAHFS4821K1ZX&m=10&part=summary&task=09df174e-58eb-41e0-8a52-afb0cf0855bb)
> 
> **Figures that moved 25% or more against Sep 2026**
> | Field | Oct 2026 | Sep 2026 | Change |
> |---|---|---|---|
> | ITC used — IGST | ₹13,400 | ₹9,600 | +40% |
> | ITC used — CGST | ₹39,350 | ₹28,100 | +40% |
> | ITC used — SGST | ₹39,350 | ₹28,100 | +40% |
> | Cash paid — IGST | ₹5,900 | ₹8,800 | −33% |
> | Cash paid — CGST | ₹3,850 | ₹13,150 | −71% |
> | Cash paid — SGST | ₹3,850 | ₹13,150 | −71% |
> | Interest / late fee | ₹0 / ₹0 | ₹310 / ₹200 | −100% |
> 
> Output tax rose only 5% in each head. The arithmetic holds (output less ITC equals cash in every head), so the drop in cash paid comes entirely from the 40% jump in ITC. Sep 2026 was lodged late on 24 Oct 2026, which explains last month's interest and late fee.
> 
> **Checklist steps still open:** Interest / late fee computed (optional), Review, Lodge GSTR-3B.
> **Documents not on file:** Liability computed, Client approval of tax payable, Payment made, Acknowledgement. None has been requested from the client yet.
> 
> **My proposal: Return with points**
> 1. ITC is up 40% while output tax is up only 5%. Please attach the ITC reconciliation against GSTR-2B for Oct 2026 and explain the increase (capital goods, a one-off purchase, or credit carried over from an earlier month).
> 2. Upload the liability working. "Liability computed" is not on file, so the figures cannot be traced.
> 3. Get the client's approval of tax payable (cash ₹13,600 in total) before payment.
> 4. Close the interest / late fee step. If it is lodged by 20 Nov 2026, record it as nil.
> 
> Payment and acknowledgement come after review, so they are not points.
> 
> Should I return it to Riya with these points, or pass it?

## #partner-signoff

🧭 **template kickoff** · 2026-11-06 15:05 IST

> @dhvaj-reviewer this is #partner-signoff. Say in one line that partners
> sign and lodge in the portal, and you bring them a pack with the link.

🤖 **dhvaj-reviewer** · 2026-11-06 15:05 IST

> Partners sign and lodge in the Dhvaj Portal. I never do. I bring the partner a five-line pack with the portal link for each filing that passes review and each certificate that's ready.

## #notices-itr

🧭 **template kickoff** · 2026-11-06 15:05 IST

> @dhvaj-notices this is #notices-itr. List the open notices with their
> next dates (notice_deadlines), then the returns still to be
> e-verified (everify_pending).

🤖 **dhvaj-notices** · 2026-11-06 15:06 IST

> **Open notices:** none. The portal shows no open income tax, GST or TDS notices today (6 Nov 2026). [Notices](http://localhost:3100/notices)
> 
> **Returns still to be e-verified (AY 2026-27):** 1, and it is overdue.
> - **Sunita Mehta** (AGRPM8812L) · filed 24 Jul 2026 · ack 284719366110726 · e-verify was due 23 Aug 2026 · ⚠️ **overdue** · preparer Manager X · [open return](http://localhost:3100/itr/abd5c28a-4088-435a-83d3-d127bbb39b16)
> 
> The 30-day window has passed, so this return is treated as not filed until it is fixed. Shall I send Sunita Mehta an e-verify reminder? Reply *send* and I'll send it in your name.
