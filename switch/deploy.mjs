#!/usr/bin/env node
// Deploys the Dhvaj Desk template to a Switch server, the way Switch Console's
// Deploy does: the server creates the three agents on your machine (Console's
// own, for `location: local`), working in agents/<name>/ of this checkout,
// then the five linked rooms with their kickoffs.
//
//   npm run agents && npm run deploy && npm run connect
//   npm run deploy -- --replace   (remove this template's agents, rooms and
//                                  group first: a clean slate, e.g. before
//                                  recording; Mattermost channels are archived)
//
// Same sign-in as connect (Switch Console's local server is found by itself).

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { signIn } from './gateway.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = path.join(ROOT, 'switch', 'dhvaj-desk.template.yaml');

const AGENTS = ['dhvaj-desk', 'dhvaj-chaser', 'dhvaj-reviewer', 'dhvaj-notices'];
const ROOMS = ['firm-ops', 'compliance-desk', 'client-chase', 'review-queue', 'partner-signoff', 'notices-itr'];
const GROUP = 'Dhvaj Desk';

for (const a of AGENTS) {
  if (!existsSync(path.join(ROOT, 'agents', a, '.mcp.json'))) {
    console.error(`agents/${a}/.mcp.json is missing: run \`npm run agents\` first.`);
    process.exit(1);
  }
}

const { gw } = await signIn();

if (process.argv.includes('--replace')) {
  const rooms = (await gw('GET', '/rooms')).filter((r) => ROOMS.includes(r.name));
  for (const r of rooms) {
    await gw('DELETE', `/rooms/${r.id}?retire_channel=true`);
    console.log(`− #${r.name} removed`);
  }
  for (const a of AGENTS) {
    try {
      await gw('DELETE', `/agents/by-name/${a}`);
      console.log(`− agent ${a} removed`);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
  const groups = await gw('GET', '/room-groups').catch(() => []);
  for (const g of (Array.isArray(groups) ? groups : (groups?.items ?? [])).filter((x) => x.name === GROUP)) {
    await gw('DELETE', `/room-groups/${g.id}`);
    console.log(`− group ${GROUP} removed`);
  }
}

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
