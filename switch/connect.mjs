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

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOMS = ['firm-ops', 'compliance-desk', 'client-chase', 'review-queue', 'partner-signoff', 'notices-itr'];
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Switch Console's own local server (macOS): its ports and its local admin
// login live in Console's data folder. Used only when SWITCH_URL / SWITCH_EMAIL
// / SWITCH_PASSWORD are not given; the password is never printed.
const CONSOLE_DIR = path.join(homedir(), 'Library', 'Application Support', 'switchdash', 'local-switch-server');
function consoleLocal() {
  try {
    const ports = JSON.parse(readFileSync(path.join(CONSOLE_DIR, 'ports.json'), 'utf8'));
    const env = Object.fromEntries(
      readFileSync(path.join(CONSOLE_DIR, 'native', 'run', 'switch-core.env'), 'utf8')
        .split('\n')
        .map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim()))
        .filter(Boolean)
        .map(([, k, v]) => [k, v.replace(/^(['"])(.*)\1$/, '$2')]),
    );
    return { url: `http://127.0.0.1:${ports.api}`, email: env.GATEWAY_ADMIN_EMAIL, password: env.GATEWAY_ADMIN_PASSWORD };
  } catch {
    return null;
  }
}
const local = process.env.SWITCH_URL ? null : consoleLocal();
if (local) console.log(`Using Switch Console's local server at ${local.url}`);
const URL_ = (process.env.SWITCH_URL || local?.url || 'http://localhost:8000').replace(/\/$/, '');
const createRooms = process.argv.includes('--create-rooms');

let cookie = '';
async function gw(method, p, body) {
  const res = await fetch(`${URL_}/gateway${p}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} /gateway${p} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const email = process.env.SWITCH_EMAIL || local?.email;
const password = process.env.SWITCH_PASSWORD || local?.password;
if (!email || !password) {
  console.error('Set SWITCH_EMAIL and SWITCH_PASSWORD (your Switch login).');
  process.exit(1);
}
await gw('POST', '/auth/login', { email, password });

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
  let room = existing.find((r) => r.name === name);
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

const out = { url: URL_, agentId: agent.id, apiKey: agent.api_key, rooms };
await writeFile(path.join(ROOT, '.switch.json'), `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
console.log(`\nSaved .switch.json. Start the portal API with:\n`);
console.log(`NOTIFICATION_CHANNELS=portal,switch`);
console.log(`SWITCH_URL=${URL_}`);
console.log(`SWITCH_AGENT_ID=${agent.id}`);
console.log(`SWITCH_API_KEY=<apiKey in .switch.json>`);
console.log(`SWITCH_ROOMS='${JSON.stringify(rooms)}'`);
