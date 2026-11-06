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

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { signIn } from './gateway.mjs';

export const ROOMS = ['firm-ops', 'compliance-desk', 'client-chase', 'review-queue', 'partner-signoff', 'notices-itr'];
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const createRooms = process.argv.includes('--create-rooms');

const { url: URL_, gw } = await signIn();

// Keep dhvaj-portal's key while it still works, so a redeploy of the template
// needs no restart of the portal API. --new-key registers it afresh.
async function savedAgent() {
  if (process.argv.includes('--new-key')) return null;
  try {
    const saved = JSON.parse(await readFile(path.join(ROOT, '.switch.json'), 'utf8'));
    if (saved.url !== URL_) return null;
    const r = await fetch(`${URL_}/agents/${saved.agentId}/ops/list_rooms`, {
      method: 'POST',
      headers: { authorization: `Bearer ${saved.apiKey}`, 'content-type': 'application/json' },
      body: '{}',
    });
    return r.ok ? { id: saved.agentId, api_key: saved.apiKey } : null;
  } catch {
    return null;
  }
}
let agent = await savedAgent();
if (agent) console.log(`✓ dhvaj-portal already registered (${agent.id}); its key still works`);
else {
  agent = await gw('POST', '/agents/register-other', {
    name: 'dhvaj-portal',
    display_name: 'Dhvaj Portal',
    description: 'The Dhvaj Portal itself: posts what is due, client uploads, reviews and sign-offs',
    overwrite: true,
  });
  console.log(`✓ dhvaj-portal registered (${agent.id}) — restart the portal API with the new key`);
}

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
    // Just after a deploy Switch may still be setting the room up: retry.
    for (let i = 1; ; i++) {
      try {
        await gw('POST', `/rooms/${room.id}/agents`, { agent_ids: [agent.id] });
        break;
      } catch (e) {
        if (i >= 5 || e.status < 500) throw e;
        await new Promise((r) => setTimeout(r, 3000 * i));
      }
    }
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
  certificate_signed: 'dhvaj-desk',
};

const out = { url: URL_, agentId: agent.id, apiKey: agent.api_key, rooms, mentions: MENTIONS };
await writeFile(path.join(ROOT, '.switch.json'), `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
// The same, for the portal API in docker compose (env_file). Inside a
// container the host's loopback is host.docker.internal. Rooms are found by
// name, so a redeploy of the template needs no change here.
const dockerUrl = URL_.replace(/\/\/(127\.0\.0\.1|localhost)([:/])/, '//host.docker.internal$2');
const envSwitch = [
  '# Written by npm run connect. Holds the dhvaj-portal agent key: keep it private.',
  'NOTIFICATION_CHANNELS=portal,switch',
  `SWITCH_URL=${dockerUrl}`,
  `SWITCH_AGENT_ID=${agent.id}`,
  `SWITCH_API_KEY=${agent.api_key}`,
  `SWITCH_MENTIONS='${JSON.stringify(MENTIONS)}'`,
  '',
].join('\n');
await writeFile(path.join(ROOT, '.env.switch'), envSwitch, { mode: 0o600 });
console.log(`\nSaved .switch.json and .env.switch (docker compose up -d api picks it up).`);
console.log(`\nTo run the portal API outside docker, start it with:\n`);
console.log(`NOTIFICATION_CHANNELS=portal,switch`);
console.log(`SWITCH_URL=${URL_}`);
console.log(`SWITCH_AGENT_ID=${agent.id}`);
console.log(`SWITCH_API_KEY=<apiKey in .switch.json>`);
console.log(`SWITCH_ROOMS='${JSON.stringify(rooms)}'`);
console.log(`SWITCH_MENTIONS='${JSON.stringify(MENTIONS)}'`);
