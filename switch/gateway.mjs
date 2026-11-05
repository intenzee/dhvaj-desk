// Signs in to a Switch server's gateway (its management API) as a person.
//
// With no SWITCH_URL it uses Switch Console's own local server: Console keeps
// its ports and its local admin login in its data folder (macOS). For any
// other server set SWITCH_URL, SWITCH_EMAIL and SWITCH_PASSWORD. The password
// is never printed.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

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

/** Signs in and returns { url, gw(method, path, body) }. */
export async function signIn() {
  const local = process.env.SWITCH_URL ? null : consoleLocal();
  if (local) console.log(`Using Switch Console's local server at ${local.url}`);
  const url = (process.env.SWITCH_URL || local?.url || 'http://localhost:8000').replace(/\/$/, '');
  const email = process.env.SWITCH_EMAIL || local?.email;
  const password = process.env.SWITCH_PASSWORD || local?.password;
  if (!email || !password) {
    console.error('Set SWITCH_EMAIL and SWITCH_PASSWORD (your Switch login).');
    process.exit(1);
  }

  let cookie = '';
  async function gw(method, p, body) {
    const res = await fetch(`${url}/gateway${p}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`${method} /gateway${p} → ${res.status}: ${text.slice(0, 1500)}`);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }
  await gw('POST', '/auth/login', { email, password });
  return { url, gw };
}
