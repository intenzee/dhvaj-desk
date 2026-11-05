#!/usr/bin/env node
// The live bridge: portal → chat, as it happens.
//
// For each agent it follows the portal's live stream (/live/stream) as that
// agent's own portal user. When a person gives the agent a quick task in the
// portal, or answers a quick task the agent gave, the bridge posts it into the
// agent's home room as dhvaj-portal, @mentioning the agent so it picks it up.
// So a partner can direct an agent from the portal (or its phone app) and the
// conversation carries on in chat.
//
//   npm run bridge          (reads .switch.json, written by npm run connect)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Portal } from '../lib/portal.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = process.env.DHVAJ_API_URL || 'http://localhost:3101/api/v1';
const WEB = (process.env.DHVAJ_WEB_URL || 'http://localhost:3100').replace(/\/$/, '');
const DOMAIN = process.env.DHVAJ_AGENT_DOMAIN || 'dhvaj.demo';

export const HOMES = [
  { agent: 'dhvaj-desk', email: `agent-desk@${DOMAIN}`, room: 'firm-ops' },
  { agent: 'dhvaj-chaser', email: `agent-chaser@${DOMAIN}`, room: 'client-chase' },
  { agent: 'dhvaj-reviewer', email: `agent-reviewer@${DOMAIN}`, room: 'review-queue' },
  { agent: 'dhvaj-notices', email: `agent-notices@${DOMAIN}`, room: 'notices-itr' },
];

const sw = JSON.parse(readFileSync(path.join(ROOT, '.switch.json'), 'utf8'));

async function post(roomKey, content) {
  const roomId = sw.rooms[roomKey] ?? sw.rooms['firm-ops'];
  if (!roomId) return console.warn(`· no room for #${roomKey}`);
  const res = await fetch(`${sw.url}/agents/${sw.agentId}/message`, {
    method: 'POST',
    headers: { authorization: `Bearer ${sw.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ room_id: roomId, content }),
  });
  if (!res.ok) throw new Error(`Switch refused the post: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** The chat message for one live event, or null when there is nothing to say. */
export function messageFor(home, kind, task) {
  const link = `${WEB}/quick-tasks?task=${task.id}`;
  const about = task.entityLabel ? ` · ${task.entityLabel.replace(/^\S+ · /, '')}` : '';
  if (kind === 'quick_task.assigned') {
    return [
      `@${home.agent} ${task.urgent ? '🔴 ' : ''}quick task #${task.number} from **${task.assignedBy?.name ?? 'someone'}**${about}:`,
      `**${task.title}**`,
      task.details || null,
      `quickTaskId \`${task.id}\` — reply with reply_quick_task · ${link}`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (kind === 'quick_task.reply') {
    const last = [...(task.messages ?? [])].reverse().find((m) => !m.mine);
    if (!last) return null;
    const status = last.status ? ` (marked *${last.status}*)` : '';
    return [
      `@${home.agent} **${last.authorName}** answered quick task #${task.number} “${task.title}”${status}:`,
      last.body ? `> ${last.body.replace(/\n/g, '\n> ')}` : null,
      `quickTaskId \`${task.id}\` · ${link}`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return null;
}

async function follow(home) {
  const portal = new Portal({ url: API, email: home.email, password: process.env.DHVAJ_AGENT_PASSWORD });
  for (let wait = 1000; ; wait = Math.min(wait * 2, 30_000)) {
    try {
      console.log(`↻ ${home.agent}: following the portal's live stream`);
      await portal.stream('/live/stream', async ({ event, data }) => {
        wait = 1000;
        if (event !== 'quick_task.assigned' && event !== 'quick_task.reply') return;
        try {
          const task = await portal.get(`/quick-tasks/${data.taskId}`);
          const text = messageFor(home, event, task);
          if (!text) return;
          await post(home.room, text);
          console.log(`→ #${home.room}: ${event} #${task.number} for ${home.agent}`);
        } catch (e) {
          console.error(`✗ ${home.agent} ${event}: ${e.message}`);
        }
      });
      console.warn(`· ${home.agent}: stream ended`);
    } catch (e) {
      console.error(`✗ ${home.agent}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, wait));
  }
}

// The portal's notification outbox (SwitchChannel among it) is drained by
// its /internal/cron, which a deployment calls on a schedule. With
// DHVAJ_CRON_SECRET set the bridge calls it too, so a local demo's
// "review requested" or "document uploaded" reaches chat within seconds.
function tickCron(secret, everyMs) {
  const run = async () => {
    try {
      const res = await fetch(`${API}/internal/cron`, { headers: { authorization: `Bearer ${secret}` } });
      if (!res.ok) console.error(`✗ cron: ${res.status}`);
    } catch (e) {
      console.error(`✗ cron: ${e.message}`);
    }
  };
  console.log(`↻ draining the portal's notification outbox every ${everyMs / 1000}s`);
  run();
  setInterval(run, everyMs);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.DHVAJ_CRON_SECRET) tickCron(process.env.DHVAJ_CRON_SECRET, Number(process.env.DHVAJ_CRON_EVERY_MS || 30_000));
  const only = process.env.DHVAJ_BRIDGE_AGENTS?.split(',');
  await Promise.all(HOMES.filter((h) => !only || only.includes(h.agent)).map(follow));
}
