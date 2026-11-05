#!/usr/bin/env node
// Deploys the Dhvaj Desk template to a Switch server, the way Switch Console's
// Deploy does: the server creates the three agents on your machine (Console's
// own, for `location: local`), working in agents/<name>/ of this checkout,
// then the five linked rooms with their kickoffs.
//
//   npm run agents && npm run deploy && npm run connect
//
// Same sign-in as connect (Switch Console's local server is found by itself).

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { signIn } from './gateway.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = path.join(ROOT, 'switch', 'dhvaj-desk.template.yaml');

for (const a of ['dhvaj-desk', 'dhvaj-chaser', 'dhvaj-reviewer']) {
  if (!existsSync(path.join(ROOT, 'agents', a, '.mcp.json'))) {
    console.error(`agents/${a}/.mcp.json is missing: run \`npm run agents\` first.`);
    process.exit(1);
  }
}

const { gw } = await signIn();
try {
  const out = await gw('POST', '/rooms/from-template-document', {
    template: readFileSync(TEMPLATE, 'utf8'),
    inputs: { checkout: ROOT },
    template_name: 'Dhvaj Desk',
  });
  for (const a of out.created_agents ?? []) {
    console.log(`✓ agent ${a.name} on ${a.machine?.name ?? a.machine?.id ?? a.machine}${a.listening ? '' : ' (not listening yet: its kickoff may wait)'}`);
  }
  const rooms = (out.room?.rooms ?? []).map((r) => `#${r.room_name}`);
  console.log(`✓ ${out.room?.group_name ?? 'rooms'}: ${rooms.join(', ') || JSON.stringify(out.room).slice(0, 400)}`);
  console.log('\nNext: npm run connect');
} catch (e) {
  console.error(`✗ deploy refused\n${e.message}`);
  process.exit(1);
}
