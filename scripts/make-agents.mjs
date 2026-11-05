#!/usr/bin/env node
// Builds each agent's working folder under agents/<name>/ — the directory the
// Switch template gives that agent. Each folder gets:
//   .mcp.json              dhvaj-mcp, signed in as that agent's own portal user
//   .claude/settings.local.json  trusts that server and allows its tools
//   CLAUDE.md              the ground rules every Dhvaj agent works by
//
//   DHVAJ_API_URL=http://localhost:3101/api/v1 DHVAJ_WEB_URL=http://localhost:3100 npm run agents

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = process.env.DHVAJ_API_URL || 'http://localhost:3101/api/v1';
const WEB = process.env.DHVAJ_WEB_URL || 'http://localhost:3100';
const DOMAIN = process.env.DHVAJ_AGENT_DOMAIN || 'dhvaj.demo';

export const AGENTS = [
  { name: 'dhvaj-desk', email: `agent-desk@${DOMAIN}` },
  { name: 'dhvaj-chaser', email: `agent-chaser@${DOMAIN}` },
  { name: 'dhvaj-reviewer', email: `agent-reviewer@${DOMAIN}` },
  { name: 'dhvaj-notices', email: `agent-notices@${DOMAIN}` },
];

const RULES = `# Working rules for every Dhvaj agent

You work for a chartered accountants' firm through the Dhvaj Portal, using
the \`dhvaj\` tools. The portal is the firm's record; you are a colleague in
its chat rooms.

1. **Answer only from tool results.** Every date, status, amount, name and
   count you post comes from a dhvaj tool result in this conversation. Quote
   the portal's dates as they are (\`dueDate\`) and give the \`link\` so people
   can open the page. If a tool did not tell you, say you do not know and
   which tool would — never estimate a due date or a status.
2. **People hold the pen.** Anything sent to a client needs a person's yes in
   the room first: post the draft, wait for the reply, then pass
   \`approval: {by, messageLink}\` naming that person and their message.
   Signing, UDINs, lodging and partner sign-off are a partner's: hand those
   over with a link; never try them.
3. **When the portal refuses, say so plainly** with its reason. It is
   enforcing the firm's rules (your role, the client's KYC, a lock).
4. **Short and Indian-English.** Use ₹, Indian dates (20 Nov 2026), and the
   forms' own names (GSTR-3B, ECR, Form 146). One message per update.
`;

for (const a of AGENTS) {
  const dir = path.join(ROOT, 'agents', a.name);
  await mkdir(path.join(dir, '.claude'), { recursive: true });
  const env = {
    DHVAJ_API_URL: API,
    DHVAJ_WEB_URL: WEB,
    DHVAJ_EMAIL: a.email,
    DHVAJ_APPROVALS_LOG: path.join(ROOT, 'approvals.jsonl'),
  };
  if (process.env.DHVAJ_AGENT_PASSWORD) env.DHVAJ_PASSWORD = process.env.DHVAJ_AGENT_PASSWORD;
  await writeFile(
    path.join(dir, '.mcp.json'),
    `${JSON.stringify(
      { mcpServers: { dhvaj: { command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')], env } } },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(dir, '.claude', 'settings.local.json'),
    `${JSON.stringify(
      { enableAllProjectMcpServers: true, enabledMcpjsonServers: ['dhvaj'], permissions: { allow: ['mcp__dhvaj'] } },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(dir, 'CLAUDE.md'), RULES);
  console.log(`✓ ${path.relative(ROOT, dir)}  (portal user ${a.email})`);
}
console.log(`\nIn Switch Console, deploy switch/dhvaj-desk.template.yaml with checkout = ${ROOT}`);
