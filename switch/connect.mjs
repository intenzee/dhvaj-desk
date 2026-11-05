#!/usr/bin/env node
// Connects the Dhvaj Portal to a Switch server as an agent of its own,
// "dhvaj-portal", in the Dhvaj Desk rooms. Run it once after deploying the
// template:
//
//   npm run connect     (Switch Console's local server: found by itself)
//   SWITCH_URL=https://switch.example SWITCH_EMAIL=you@firm.in SWITCH_PASSWORD=… npm run connect
//
// It registers dhvaj-portal (the API key is shown once and kept in
// .switch.json), finds the template's rooms by name, adds dhvaj-portal to each,
// and prints the env the portal API needs for its `switch` notification
// channel. `--create-rooms` makes any missing room (for trying it out without
// Switch Console).

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { signIn } from './gateway.mjs';

export const ROOMS = ['firm-ops', 'compliance-desk', 'client-chase', 'review-queue', 'partner-signoff', 'notices-itr'];
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const createRooms = process.argv.includes('--create-rooms');

const { url: URL_, gw } = await signIn();

const agent = await gw('POST', '/agents/register-other', {
  name: 'dhvaj-portal',
  display_name: 'Dhvaj Portal',
  description: 'The Dhvaj Portal itself: posts what is due, client uploads, reviews and sign-offs',
  overwrite: true,
});
console.log(`✓ dhvaj-portal registered (${agent.id})`);

const existing = await gw('GET', '/rooms');
const rooms = {};
for (const name of ROOMS) {
  // Exact name first; Console may prefix a template's rooms (e.g. "dhvaj-desk-firm-ops").
  let room =
    existing.find((r) => r.name === name) ??
    existing.find((r) => r.name?.endsWith(`-${name}`) || r.name?.endsWith(`/${name}`));
  if (!room && createRooms) {
    room = await gw('POST', '/rooms', { name, description: `Dhvaj Desk — #${name}`, agent_ids: [agent.id] });
    console.log(`✓ #${name} created`);
  } else if (room) {
    await gw('POST', `/rooms/${room.id}/agents`, { agent_ids: [agent.id] });
    console.log(`✓ #${name}: dhvaj-portal added`);
  } else {
    console.log(`· #${name} not found (deploy the template, or pass --create-rooms)`);
    continue;
  }
  rooms[name] = room.id;
}

if (Object.keys(rooms).length < ROOMS.length) {
  const names = existing.map((r) => r.name).filter(Boolean);
  console.log(`\nRooms on this Switch server: ${names.length ? names.map((n) => `#${n}`).join(', ') : 'none yet'}`);
}

// Which agent each kind of portal post asks to act: Switch hands an agent only
// the messages that @mention it.
export const MENTIONS = {
  task_review_requested: 'dhvaj-reviewer',
  document_uploaded: 'dhvaj-chaser',
  notice_received: 'dhvaj-notices',
};

const out = { url: URL_, agentId: agent.id, apiKey: agent.api_key, rooms, mentions: MENTIONS };
await writeFile(path.join(ROOT, '.switch.json'), `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
console.log(`\nSaved .switch.json. Start the portal API with:\n`);
console.log(`NOTIFICATION_CHANNELS=portal,switch`);
console.log(`SWITCH_URL=${URL_}`);
console.log(`SWITCH_AGENT_ID=${agent.id}`);
console.log(`SWITCH_API_KEY=<apiKey in .switch.json>`);
console.log(`SWITCH_ROOMS='${JSON.stringify(rooms)}'`);
console.log(`SWITCH_MENTIONS='${JSON.stringify(MENTIONS)}'`);
