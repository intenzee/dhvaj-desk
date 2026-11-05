#!/usr/bin/env node
// Puts the demo story back at its start, through the portal API like the seed:
//
//   - Sharma Traders' October GSTR-3B: Riya has prepared it and it waits in
//     dhvaj-reviewer's To Review inbox (the #review-queue scene).
//   - Sharma's October PF return: open and nobody's yet, for the
//     "give the PF return to Riya" scene in #compliance-desk.
//   - The October sales register request stays open (the #client-chase scene).
//
//   npm run demo:reset        (after npm run seed; safe to run again)

import { Portal } from '../lib/portal.mjs';

const API = process.env.DHVAJ_API_URL || 'http://localhost:3101/api/v1';
const mp = new Portal({ url: API, email: process.env.DHVAJ_MP_EMAIL || 'mp@dhvaj.in' });
const riya = new Portal({ url: API, email: 'riya@dhvaj.demo' });
const items = (r) => (Array.isArray(r) ? r : (r?.items ?? []));
const log = (...a) => console.log('[demo-reset]', ...a);

const sharma = items(await mp.get('/entities', { search: 'Sharma Traders', limit: 5 })).find((e) => e.legalName === 'Sharma Traders');
if (!sharma) throw new Error('Sharma Traders is not in the portal: run npm run seed first.');
const cal = items(await mp.get('/compliance/calendar', { entityId: sharma.id, includeOverdue: true, from: '2026-04-01', to: '2026-12-31' }));
const filing = (form, periodKey) => {
  const row = cal.find((i) => i.formLabel === form && i.periodKey === periodKey);
  if (!row) throw new Error(`no ${form} ${periodKey} on Sharma Traders' calendar`);
  return row.id;
};

const people = items(await mp.get('/quick-tasks/people'));
const person = (re) => {
  const p = people.find((x) => re.test(x.name));
  if (!p) throw new Error(`no person matching ${re}`);
  return p.id;
};

// 1. GSTR-3B Oct: Riya prepares, dhvaj-reviewer reviews; sent for review.
const g3b = filing('GSTR-3B', '2026-10');
const assigned = await mp.post('/compliance/runs/assign', {
  instanceIds: [g3b],
  preparerId: person(/^Riya/),
  reviewerId: person(/dhvaj-reviewer/),
});
if (assigned.failed?.length) throw new Error(assigned.failed.map((f) => f.message).join('; '));

for (let i = 0; i < 6; i++) {
  const ws = await riya.get(`/compliance-instances/${g3b}`);
  const t = ws.task;
  const go = (a, body = {}) => riya.post(`/engagements/${ws.instance.engagementId}/tasks/${t.id}/${a}`, { version: t.version, ...body });
  if (t.status === 'done') await go('reopen', { reason: 'Demo reset: back to review' });
  else if (['todo', 'blocked', 'returned'].includes(t.status)) await go('start');
  else if (t.status === 'in_progress') await go('send-for-review');
  else {
    log(`✓ GSTR-3B Oct 2026 is ${t.status} with ${t.reviewerName ?? 'the reviewer'}`);
    break;
  }
}

// 2. PF Oct: left open for the scene; just report who has it.
try {
  const pf = cal.find((i) => /PF|ECR/i.test(i.formLabel) && i.periodKey === '2026-10');
  if (pf) {
    const ws = await mp.get(`/compliance-instances/${pf.id}`);
    log(`· ${ws.instance.formLabel} Oct 2026: ${ws.task?.assigneeName ? `with ${ws.task.assigneeName}` : 'nobody yet'} (${ws.task?.status ?? ws.instance.workflowStatus})`);
  }
} catch (e) {
  log(`· PF return: ${e.message}`);
}

// 3. Sales register request still open?
const g1 = await mp.get(`/compliance-instances/${filing('GSTR-1', '2026-10')}`);
const slot = g1.slots?.find((s) => s.slotCode === 'SALES_REGISTER');
log(slot?.openRequest ? '✓ sales register request is open' : '· sales register request is not open (run npm run seed)');
