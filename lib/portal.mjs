// A small client for the Dhvaj Portal API, signed in as ONE portal user.
//
// Every call goes through the portal's own API, so the portal's permission
// checks, row-level security and audit trail apply to whoever this client is
// signed in as. An agent never talks to the database.
//
// Sign-in: DHVAJ_PASSWORD set → POST /auth/login (portal password login).
// Otherwise POST /auth/dev-token, which only a non-production portal serves.

const DEFAULT_URL = 'http://localhost:3101/api/v1';

export class PortalError extends Error {
  constructor(status, body, method, path) {
    const msg =
      (body && (Array.isArray(body.details) ? body.details.join('; ') : body.message)) ||
      `HTTP ${status}`;
    super(`${method} ${path} → ${status}: ${msg}`);
    this.status = status;
    this.body = body;
  }
}

export class Portal {
  /** @param {{ url?: string, email: string, password?: string }} opts */
  constructor({ url = process.env.DHVAJ_API_URL || DEFAULT_URL, email, password } = {}) {
    if (!email) throw new Error('Portal: an email is required (DHVAJ_EMAIL).');
    this.url = url.replace(/\/$/, '');
    this.email = email;
    this.password = password;
    this.token = null;
    this.tokenAt = 0;
  }

  static fromEnv() {
    return new Portal({
      url: process.env.DHVAJ_API_URL,
      email: process.env.DHVAJ_EMAIL,
      password: process.env.DHVAJ_PASSWORD || undefined,
    });
  }

  async signIn() {
    const path = this.password ? '/auth/login' : '/auth/dev-token';
    const body = this.password
      ? { email: this.email, password: this.password }
      : { email: this.email };
    const res = await fetch(this.url + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new PortalError(res.status, data, 'POST', path);
    this.token = data.accessToken;
    this.tokenAt = Date.now();
    return this.token;
  }

  async authHeader() {
    // Renew well inside the portal's token lifetime.
    if (!this.token || Date.now() - this.tokenAt > 20 * 60 * 1000) await this.signIn();
    return `Bearer ${this.token}`;
  }

  async request(method, path, body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(this.url + path, {
        method,
        headers: {
          authorization: await this.authHeader(),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401 && attempt === 0) {
        this.token = null;
        continue;
      }
      const text = await res.text();
      const data = text ? safeJson(text) : null;
      if (!res.ok) throw new PortalError(res.status, data, method, path);
      return data;
    }
    throw new Error('unreachable');
  }

  get(path, query) {
    return this.request('GET', path + qs(query));
  }
  post(path, body = {}) {
    return this.request('POST', path, body);
  }
  patch(path, body = {}) {
    return this.request('PATCH', path, body);
  }
  put(path, body = {}) {
    return this.request('PUT', path, body);
  }

  /** Follow an SSE stream (e.g. /live/stream), calling onEvent({event, data}). */
  async stream(path, onEvent, { signal } = {}) {
    const res = await fetch(this.url + path, {
      headers: { authorization: await this.authHeader(), accept: 'text/event-stream' },
      signal,
    });
    if (!res.ok) throw new PortalError(res.status, null, 'GET', path);
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let event = 'message';
        const lines = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) lines.push(line.slice(5).trimStart());
        }
        if (lines.length) onEvent({ event, data: safeJson(lines.join('\n')) });
      }
    }
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function qs(query) {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Today in India (the portal's clock), as YYYY-MM-DD. */
export function istToday(d = new Date()) {
  return new Date(d.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}
