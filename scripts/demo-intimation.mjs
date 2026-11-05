#!/usr/bin/env node
// The #notices-itr scene's trigger, as a person would do it on the portal's
// ITR desk: Manager X records Anil Mehta's 143(1) intimation (a ₹14,350
// demand). The portal opens a notice and posts it into #notices-itr for
// @dhvaj-notices. All details are made up.
//
//   npm run demo:intimation      (after npm run demo:reset)

import { Portal } from '../lib/portal.mjs';

const API = process.env.DHVAJ_API_URL || 'http://localhost:3101/api/v1';
const manager = new Portal({ url: API, email: process.env.DHVAJ_MANAGER_EMAIL || 'manager.x@dhvaj.in' });
const items = (r) => (Array.isArray(r) ? r : (r?.items ?? []));

const season = items(await manager.get('/itr/season', { financialYear: '2025-26', scope: 'all' }));
const row = season.find((x) => x.entityName === 'Anil Mehta');
if (!row?.returnId) throw new Error('Anil Mehta has no return on the ITR desk: run npm run seed.');
const ret = await manager.get(`/itr/returns/${row.returnId}`);
const r = await manager.post(`/itr/returns/${row.returnId}/intimation`, {
  version: ret.version,
  kind: '143_1',
  referenceNo: 'CPC/2627/A1/481920337',
  issuedOn: '2026-11-02',
  receivedOn: '2026-11-04',
  result: 'demand',
  amount: '14350',
  summary: 'Interest income from FD (AIS) not offered; demand of Rs 14,350 under s.143(1)(a).',
});
console.log(`✓ Anil Mehta's 143(1) recorded${r.noticeId ? ` — notice ${r.noticeId} opened` : ' (no notice opened)'}`);
