#!/usr/bin/env node
// Export what happened in the Dhvaj Desk rooms to Markdown, straight from
// Switch: every thread in each room, oldest first, with who said it and when.
// Joins, "starting a session" notices and greetings are left out.
//
//   npm run transcript                 → docs/transcript.md
//   npm run transcript -- out.md       → another file
//
// Reads .switch.json (written by npm run connect) and reads as dhvaj-portal,
// which is a member of every room.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'docs', 'transcript.md'));
const ROOMS = ['firm-ops', 'compliance-desk', 'client-chase', 'review-queue', 'partner-signoff', 'notices-itr'];

const sw = JSON.parse(readFileSync(path.join(ROOT, '.switch.json'), 'utf8'));

async function readRoom(roomId) {
  const r = await fetch(`${sw.url}/agents/${encodeURIComponent(sw.agentId)}/ops/read_context`, {
    method: 'POST',
    headers: { authorization: `Bearer ${sw.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ room_id: roomId }),
  });
  if (!r.ok) throw new Error(`read_context ${r.status}`);
  return (await r.json()).result;
}

const NOISE = [
  /joined the room$/,
  /^Starting a session to handle this/,
  /^Template kickoff on behalf of/,
  // An agent's own greeting when it joins ("Hi! Mention @x to …").
  /^(Hi|Hello|Hey)[^.\n]{0,40}[.!—-]\s.*@[a-z-]+.{0,40}$/i,
  /^(Hi|Hello|Hey)!? (there!? )?(Just |Tag |Ping |Mention )?@[a-z-]+/i,
];
const noise = (m) => NOISE.some((re) => re.test(m.body.trim()));

const ist = (ms) =>
  new Date(ms + 5.5 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + ' IST';

function who(m) {
  const n = m.sender_name || m.sender;
  if (n === 'dhvaj-portal') return '🏛️ **dhvaj-portal**';
  if (/^dhvaj-/.test(n)) return `🤖 **${n}**`;
  if (n === 'admin') return '🧭 **template kickoff**';
  return `🧑 **${n}**`;
}

const quote = (body) =>
  body
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

const parts = [
  '# Dhvaj Desk — a run in the rooms',
  '',
  `Exported from Switch with \`npm run transcript\` on ${ist(Date.now())}. Every line below is what was`,
  'posted in the room, unedited: 🤖 an agent, 🧑 a person, 🧭 the kickoff from the Switch template,',
  "🏛️ the portal's own account (its live posts, or a kickoff re-sent through it).",
  'Figures, dates and names come from the demo firm in the Dhvaj Portal (all made up).',
  '',
];

for (const name of ROOMS) {
  const id = sw.rooms?.[name];
  if (!id) continue;
  const { threads } = await readRoom(id);
  const kept = threads
    .map((t) => ({ root: t.root, replies: (t.replies ?? []).filter((m) => !noise(m)) }))
    .filter((t) => !noise(t.root) || t.replies.length)
    .sort((a, b) => a.root.timestamp - b.root.timestamp);
  parts.push(`## #${name}`, '');
  if (!kept.length) parts.push('_Nothing yet._', '');
  for (const t of kept) {
    for (const m of [t.root, ...t.replies]) {
      parts.push(`${who(m)} · ${ist(m.timestamp)}${m === t.root ? '' : ' (in thread)'}`, '', quote(m.body), '');
    }
  }
}

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, `${parts.join('\n').trimEnd()}\n`);
console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
