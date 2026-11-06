#!/usr/bin/env node
// Smoke test: drives every dhvaj-mcp tool through a real MCP client against a
// running portal with the demo story seeded (npm run seed). Each agent gets its
// own server process signed in as its own portal user, exactly as in Switch.
//
//   DHVAJ_API_URL=http://localhost:3101/api/v1 npm run test:mcp

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { Portal } from '../lib/portal.mjs';

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
const { tools } = await desk.listTools();
console.log(`dhvaj-mcp exposes ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}\n`);

// ── desk: brief, due, client, my work ──
await call(desk, 'firm_brief');
await call(desk, 'due_list', { client: 'Sharma', to: '2026-11-30' });
const status = await call(desk, 'client_status', { client: 'Sharma Traders' }, { show: 900 });
await call(desk, 'my_work', { person: 'Manager X' });
await call(desk, 'due_list', { stream: 'payroll', client: 'Sharma' });

// ── chaser: preview, link, send gate ──
const chaser = await connect('agent-chaser@dhvaj.demo');
let preview = await call(chaser, 'chase_preview', { client: 'Sharma Traders' }, { show: 900 });
if (!preview.drafts?.length) {
  // Nothing waiting on the client yet (a fresh or reset demo): the chaser asks
  // for October's sales register with its own upload link, as in the story.
  const asked = await call(chaser, 'request_document', {
    client: 'Sharma Traders',
    form: 'GSTR-1',
    period: 'October',
    document: 'sales register',
    requestedInfo: 'Sales register for October 2026 (smoke test)',
  });
  if (!asked.uploadUrl?.includes('/client-upload/')) {
    failures++;
    console.log('✗ request_document gave no upload link');
  }
  // The same request twice is refused: one open request per document.
  await call(chaser, 'request_document', { client: 'Sharma Traders', form: 'GSTR-1', period: 'October', document: 'sales register' }, { expectError: true });
  preview = await call(chaser, 'chase_preview', { client: 'Sharma Traders' }, { show: 900 });
}
const dep = status.waitingOnClient?.[0];
if (dep) {
  // A senior (the chaser) may not mint links — the portal says so; the desk (a manager) may.
  await call(chaser, 'upload_link', { dependencyId: dep.dependencyId }, { expectError: true });
  await call(desk, 'upload_link', { dependencyId: dep.dependencyId });
}
const filingId = preview.drafts?.[0]?.filing?.filingId;
await call(chaser, 'chase_send', { filingId }, { expectError: true });
await call(
  chaser,
  'chase_send',
  { filingId, approval: { by: 'dhvaj-desk (agent)', messageLink: 'http://localhost:3000/r/client-chase/m/1' } },
  { expectError: true },
);
await call(chaser, 'chase_send', {
  filingId,
  channel: 'copy',
  approval: { by: 'Manager X', messageLink: 'http://localhost:3000/r/client-chase/m/1' },
});

// ── desk: assign + quick task round trip ──
await call(desk, 'assign_filing', {
  client: 'Sharma Traders',
  form: 'GSTR-3B',
  period: 'October',
  preparer: 'Riya',
  reviewer: 'dhvaj-reviewer (agent)',
});
const qt = await call(desk, 'give_quick_task', {
  person: 'Riya',
  title: 'Prepare Sharma Traders GSTR-3B for October',
  details: 'Sales register is with the client; purchase side is ready.',
  client: 'Sharma Traders',
});
if (qt.quickTaskId) {
  await call(desk, 'reply_quick_task', { quickTaskId: qt.quickTaskId, body: 'Ping me when it is in review.' });
}
await call(desk, 'list_quick_tasks', { box: 'sent' });

// ── Riya (a person, via the portal directly) sends the 3B for review ──
const riya = new Portal({ url: process.env.DHVAJ_API_URL || 'http://localhost:3101/api/v1', email: 'riya@dhvaj.demo' });
const reviewer = await connect('agent-reviewer@dhvaj.demo');
const r3b = await call(reviewer, 'compare_with_last_period', { client: 'Sharma Traders', form: 'GSTR-3B', period: 'October' }, { show: 700 });
const id3b = r3b.filing?.filingId;
async function sendForReview() {
  const ws = await riya.get(`/compliance-instances/${id3b}`);
  const t = ws.task;
  const go = (a, body = {}) =>
    riya.post(`/engagements/${ws.instance.engagementId}/tasks/${t.id}/${a}`, { version: t.version, ...body });
  if (t.status === 'done') {
    await go('reopen', { reason: 'Smoke test: run the review loop again' });
    return sendForReview();
  }
  if (['todo', 'blocked', 'returned'].includes(t.status)) {
    await go('start');
    return sendForReview();
  }
  if (t.status === 'in_progress') await go('send-for-review');
  console.log(`  (Riya: task was ${t.status}; now sent for review)`);
}
if (id3b) {
  await sendForReview();
  await call(reviewer, 'review_inbox');
  await call(reviewer, 'return_with_points', {
    filingId: id3b,
    points: ['ITC claimed is 30% above September; attach the purchase register reconciliation.'],
  });
  await sendForReview();
  await call(reviewer, 'pass_filing', { filingId: id3b, note: 'Reconciliation attached; ITC matches 2B.' });
  await call(reviewer, 'request_signoff', {
    filingId: id3b,
    partner: 'Partner A',
    summary: 'GSTR-3B Oct 2026 for Sharma Traders is reviewed and ready to lodge.',
  });
}

for (const c of [desk, chaser, reviewer]) await c.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
