#!/usr/bin/env node
// Puts the demo story back at its start, through the portal API like the seed:
//
//   - Sharma Traders' October GSTR-3B: Riya has prepared it — figures in, with
//     ITC about 40% above September's (filed late, on record) — and it waits
//     in dhvaj-reviewer's To Review inbox (the #review-queue scene).
//   - Sharma's October PF return: open and nobody's yet, for the
//     "give the PF return to Riya" scene in #compliance-desk.
//   - Sharma's October sales register: not asked for yet, so dhvaj-chaser
//     asks for it live with an upload link (the #client-chase scene).
//   - The Mehtas: no open notice yet, so Anil Mehta's 143(1) can be recorded
//     live in #notices-itr; earlier demo runs' notices are closed as dropped.
//
//   npm run demo:reset        (after npm run seed; safe to run again)

import { Portal } from '../lib/portal.mjs';
import { sharmaGst3b } from '../seed/gst-3b.mjs';

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

let prepared = false;
for (let i = 0; i < 8; i++) {
  const ws = await riya.get(`/compliance-instances/${g3b}`);
  const t = ws.task;
  const go = (a, body = {}) => riya.post(`/engagements/${ws.instance.engagementId}/tasks/${t.id}/${a}`, { version: t.version, ...body });
  if (t.status === 'done') await go('reopen', { reason: 'Demo reset: back to review' });
  else if (['todo', 'blocked', 'returned'].includes(t.status)) await go('start');
  else if (t.status === 'in_progress' && !prepared) {
    // Riya's figures and steps, against September's filed return.
    await sharmaGst3b({ mp, riya, entityId: sharma.id, log: (m) => log(m) });
    prepared = true;
  } else if (t.status === 'in_progress') await go('send-for-review');
  else {
    log(`✓ GSTR-3B Oct 2026 is ${t.status} with ${t.reviewerName ?? 'the reviewer'}`);
    break;
  }
}

// 2. PF Oct (ECR): back with Manager X, for "give the PF return to Riya".
try {
  const pf = cal.find((i) => /PF|ECR/i.test(i.formLabel) && i.periodKey === '2026-10');
  if (pf) {
    let ws = await mp.get(`/compliance-instances/${pf.id}`);
    if (!/^Manager X/.test(ws.task?.assigneeName ?? '')) {
      const r = await mp.post('/compliance/runs/assign', { instanceIds: [pf.id], preparerId: person(/^Manager X/) });
      if (r.failed?.length) throw new Error(r.failed.map((f) => f.message).join('; '));
      ws = await mp.get(`/compliance-instances/${pf.id}`);
    }
    log(`· ${ws.instance.formLabel} Oct 2026: ${ws.task?.assigneeName ? `with ${ws.task.assigneeName}` : 'nobody yet'} (${ws.task?.status ?? ws.instance.workflowStatus})`);
  }
} catch (e) {
  log(`· PF return: ${e.message}`);
}

// 3. October sales register: not asked for yet, so dhvaj-chaser asks for it
//    live (request_document) and its reminder carries a fresh upload link.
const g1Id = filing('GSTR-1', '2026-10');
const g1 = await mp.get(`/compliance-instances/${g1Id}`);
const slot = g1.slots?.find((s) => s.slotCode === 'SALES_REGISTER');
if (slot?.documents?.length) {
  // An earlier run's client upload: take it out (soft delete, audited and
  // restorable) and reopen its step, so the client can send it again.
  const engId = g1.instance.engagementId;
  for (const d of slot.documents) {
    await mp.post(`/engagements/${engId}/documents/${d.id ?? d.documentId}/delete`, { reason: 'Demo reset: the client sends it again' });
  }
  log('✓ October sales register from an earlier run removed — dhvaj-chaser asks for it live');
} else if (slot?.openRequest) {
  const engId = g1.instance.engagementId;
  const depId = slot.openRequest.dependencyId;
  const dep = await mp.get(`/engagements/${engId}/client-dependencies/${depId}`);
  await mp.post(`/engagements/${engId}/client-dependencies/${depId}/close`, {
    status: 'cancelled',
    reason: 'Demo reset: the chaser asks for it again',
    version: dep.version,
  });
  log('✓ October sales register request cancelled — dhvaj-chaser asks for it live');
} else log('✓ October sales register not asked for yet — dhvaj-chaser asks for it live');
{
  // With no sales register in the slot, its step is open again.
  const ws = await mp.get(`/compliance-instances/${g1Id}`);
  const item = ws.checklist.find((c) => c.slotCode === 'SALES_REGISTER' && c.status === 'done');
  const live = ws.slots.find((x) => x.slotCode === 'SALES_REGISTER')?.documents?.length;
  if (item && !live) await mp.patch(`/compliance-instances/${g1Id}/items/${item.id}`, { status: 'open', version: item.version });
}

// 4. The Mehtas: close notices left open by earlier runs.
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
for (const who of ['Anil Mehta', 'Sunita Mehta']) {
  const ent = items(await mp.get('/entities', { search: who, limit: 5 })).find((e) => e.legalName === who);
  if (!ent) continue;
  for (const n of items(await mp.get('/notices', { entityId: ent.id, limit: 50 })).filter((x) => !x.outcome)) {
    // A client's notice references are unique, closed or not: rename the
    // run's copy first so the same 143(1) can be recorded live again.
    const renamed = n.referenceNo.includes('(demo run')
      ? n
      : await mp.patch(`/notices/${n.id}`, { version: n.version, referenceNo: `${n.referenceNo} (demo run ${n.id.slice(0, 8)})` });
    await mp.post(`/notices/${n.id}/close`, { version: renamed.version, outcome: 'dropped', closedOn: today });
    log(`✓ closed an earlier demo notice for ${who} (${n.referenceNo})`);
  }
}
