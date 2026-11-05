#!/usr/bin/env node
// Full-tier smoke test (KYC, notices and the ITR desk, certificates,
// invoices): drives each tool through a real MCP client against a
// running portal with the demo story seeded (npm run seed). Each agent gets its
// own server process signed in as its own portal user, exactly as in Switch.
//
//   DHVAJ_API_URL=http://localhost:3101/api/v1 npm run test:full

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));
let failures = 0;

async function connect(email) {
  const client = new Client({ name: 'dhvaj-smoke', version: '0.1.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      env: { ...process.env, DHVAJ_EMAIL: email },
      stderr: 'inherit',
    }),
  );
  return client;
}

/** Call a tool; `expectError` flips what counts as a pass. */
async function call(client, name, args = {}, { expectError = false, show = 400 } = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '';
  const pass = expectError ? !!r.isError : !r.isError;
  if (!pass) failures++;
  console.log(`${pass ? '✓' : '✗'} ${name}${expectError ? ' (expected refusal)' : ''}`);
  console.log(`  ${text.replace(/\s+/g, ' ').slice(0, show)}`);
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

const desk = await connect('agent-desk@dhvaj.demo');
const notices = await connect('agent-notices@dhvaj.demo');
const reviewer = await connect('agent-reviewer@dhvaj.demo');
const person = { by: 'Manager X', messageLink: '#notices-itr/sw_smoke' };

// ── KYC ──
await call(desk, 'kyc_status');
await call(desk, 'kyc_status', { client: 'Acme Exports' });

// ── notices and the ITR desk ──
await call(notices, 'everify_pending', {}, { show: 700 });
await call(notices, 'everify_remind', { client: 'Sunita Mehta' }, { expectError: true });
await call(notices, 'everify_remind', { client: 'Sunita Mehta', approval: { by: 'dhvaj-desk (agent)', messageLink: '#x/sw_1' } }, { expectError: true });
const open = await call(notices, 'notice_deadlines', { client: 'Anil Mehta' });
if (!open.count) {
  await call(notices, 'record_intimation', {
    client: 'Anil Mehta',
    kind: '143_1',
    referenceNo: 'CPC/2627/A1/481920337',
    issuedOn: '2026-11-02',
    receivedOn: '2026-11-04',
    result: 'demand',
    amount: '14350',
    summary: 'Interest income from FD (AIS) not offered; demand of Rs 14,350 under s.143(1)(a).',
  }, { show: 900 });
}
await call(notices, 'notice_deadlines', {}, { show: 700 });

// ── certificates ──
await call(reviewer, 'certificate_prepare', { client: 'Acme Exports' }, { show: 600 });
await call(reviewer, 'certificate_prepare', {
  client: 'Acme Exports',
  certificate: '15CB',
  partner: 'Partner A',
  summary: 'Form 146 for EUR 12,000 ocean freight to Kline Logistics GmbH; DTAA Art. 8, TRC and 10F on file, nil TDS.',
});
await call(reviewer, 'certificate_prepare', { client: 'Acme Exports', certificate: '15CB', partner: 'dhvaj-desk (agent)', summary: 'x' }, { expectError: true });

// ── invoices ──
const inv = await call(desk, 'invoice_draft', { client: 'Sharma Traders', service: 'GST', amount: '3500', description: 'GST returns for October 2026' }, { show: 600 });
const engagementId = inv.invoice?.engagementId;
if (inv.invoice?.invoiceId && engagementId) {
  await call(desk, 'invoice_send', { engagementId, invoiceId: inv.invoice.invoiceId, channel: 'email', approval: { by: 'dhvaj-chaser (agent)', messageLink: '#firm-ops/sw_1' } }, { expectError: true });
  // A draft is not sendable: the portal itself refuses until a person issues it.
  await call(desk, 'invoice_send', { engagementId, invoiceId: inv.invoice.invoiceId, channel: 'email', approval: person }, { expectError: true });
}

for (const c of [desk, notices, reviewer]) await c.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
