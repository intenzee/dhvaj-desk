#!/usr/bin/env node
// dhvaj-mcp — the Dhvaj Portal as MCP tools for the Dhvaj Desk agents.
//
// Each agent runs its own copy of this server, signed in to the portal as its
// own portal user (DHVAJ_EMAIL). Every tool is a call to the portal's API, so
// the portal's permissions, row-level security and audit trail apply to the
// agent exactly as they would to a person in the same role.
//
// Two rules are built in:
//  1. Answers come from the portal. Every result carries the portal's dates
//     and a link to the page it came from; agents are told to quote them.
//  2. People hold the pen. A tool that sends something to a client needs the
//     approving person's name and a link to their chat message; the portal
//     itself refuses agents anything only a partner may do (sign, UDIN,
//     sign-off).

import { appendFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Portal, PortalError, istToday } from '../lib/portal.mjs';
import { workItemUrl, pageUrl } from './links.mjs';

const portal = Portal.fromEnv();
const APPROVALS_LOG = process.env.DHVAJ_APPROVALS_LOG || '';

// ── Small helpers ──────────────────────────────────────────────────────────

const items = (r) => (Array.isArray(r) ? r : (r?.items ?? []));
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify({ today: istToday(), ...data }, null, 1) }] };
}
function fail(message, extra = {}) {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }, null, 1) }] };
}

/** Wrap a tool so portal refusals come back as readable tool errors. */
const tool = (fn) => async (args) => {
  try {
    return await fn(args ?? {});
  } catch (e) {
    if (e instanceof PortalError) {
      return fail(`The portal refused: ${e.message}`, { status: e.status });
    }
    return fail(e.message);
  }
};

function filingRow(i) {
  return {
    filingId: i.id,
    client: i.entityName,
    form: i.formLabel,
    period: i.periodLabel,
    stream: i.stream,
    dueDate: i.dueDate,
    daysLeft: i.daysLeft,
    status: i.workflowStatus,
    assignee: i.assigneeName ?? null,
    registration: i.registrationNumber ?? null,
    link: workItemUrl(i.link),
  };
}

const OPEN = (i) => !['filed', 'not_applicable'].includes(i.workflowStatus);

async function calendar(query = {}) {
  const today = istToday();
  const to = query.to ?? addDays(today, 45);
  const r = await portal.get('/compliance/calendar', { includeOverdue: true, from: query.from ?? today, ...query, to });
  return items(r);
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function findClient(name) {
  const r = items(await portal.get('/entities', { search: name, limit: 20 }));
  if (!r.length) throw new Error(`No client matching "${name}" that you can see in the portal.`);
  const exact = r.find((e) => norm(e.legalName) === norm(name));
  if (exact || r.length === 1) return exact ?? r[0];
  const starts = r.filter((e) => norm(e.legalName).startsWith(norm(name)));
  if (starts.length === 1) return starts[0];
  throw new Error(`"${name}" matches several clients: ${r.map((e) => e.legalName).join(', ')}. Say which.`);
}

let peopleCache = null;
async function people() {
  if (!peopleCache) peopleCache = await portal.get('/quick-tasks/people');
  return peopleCache;
}
const isAgent = (p) => /\(agent\)/i.test(p.name);

async function findPerson(name) {
  const all = await people();
  const n = norm(name);
  const hits = all.filter((p) => norm(p.name) === n);
  const loose = hits.length ? hits : all.filter((p) => norm(p.name).split(' ').some((w) => w === n) || norm(p.name).startsWith(n));
  if (loose.length === 1) return loose[0];
  if (!loose.length) throw new Error(`No one called "${name}" in the portal.`);
  throw new Error(`"${name}" matches ${loose.map((p) => p.name).join(', ')}. Say which.`);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "October", "Oct 2026", "2026-10" → '2026-10' (the year defaults to the nearest one). */
function periodKeyOf(text) {
  if (!text) return null;
  const s = norm(text);
  const iso = /^(\d{4}) (\d{2})$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const m = MONTHS.findIndex((mm) => s.startsWith(mm) || s.includes(` ${mm}`));
  if (m < 0) return null;
  const y = /(\d{4})/.exec(s)?.[1];
  const today = istToday();
  let year = y ? Number(y) : Number(today.slice(0, 4));
  if (!y && m + 1 > Number(today.slice(5, 7)) + 1) year -= 1; // "December" in November → last year
  return `${year}-${String(m + 1).padStart(2, '0')}`;
}

const filingRef = {
  filingId: z.string().uuid().optional().describe('The filing id, from an earlier tool result. Preferred.'),
  client: z.string().optional().describe('Client name, when no filingId is known'),
  form: z.string().optional().describe('Form, e.g. "GSTR-3B", "ECR", "GSTR-1"'),
  period: z.string().optional().describe('Period, e.g. "October", "Oct 2026", "2026-10"'),
};

/** Resolve a filing from an id, or from client + form + period. */
async function resolveFiling({ filingId, client, form, period }) {
  if (filingId) {
    const ws = await portal.get(`/compliance-instances/${filingId}`);
    return { id: filingId, ws };
  }
  if (!client || !form) throw new Error('Give a filingId, or a client and a form (and period).');
  const ent = await findClient(client);
  const key = periodKeyOf(period);
  const rows = (await calendar({ entityId: ent.id, from: '2026-04-01', to: addDays(istToday(), 400) })).filter(
    (i) => norm(i.formLabel).includes(norm(form)) && (!key || i.periodKey === key),
  );
  const open = rows.filter(OPEN);
  const pick = (open.length ? open : rows).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (!pick.length) throw new Error(`No ${form}${period ? ` for ${period}` : ''} on ${ent.legalName}'s calendar.`);
  if (pick.length > 1 && !key) {
    // The earliest open one is what people mean by "the GSTR-3B".
  }
  const id = pick[0].id;
  return { id, ws: await portal.get(`/compliance-instances/${id}`) };
}

function filingSummary(id, ws) {
  const inst = ws.instance;
  return {
    filingId: id,
    form: inst.formLabel,
    period: inst.periodLabel,
    dueDate: inst.statutoryDueDate,
    internalDate: inst.internalDate,
    daysLeft: inst.daysLeft,
    status: inst.workflowStatus,
    lateCharges: inst.lateCharges ?? null,
    lateFeeRule: inst.lateFeeNote ?? null,
    task: ws.task
      ? { id: ws.task.id, status: ws.task.status, preparer: ws.task.assigneeName, reviewer: ws.task.reviewerName }
      : null,
    link: workItemUrl({
      engagementId: inst.engagementId,
      instanceId: id,
      stream: inst.stream,
      financialYear: inst.financialYear,
      periodKey: inst.periodKey,
      section: inst.section,
      registrationNumber: inst.registrationNumber,
    }),
  };
}

/**
 * The approval every client-facing send needs: the person who said yes in
 * chat, and a link to that message. Checked against the portal's people list
 * (an agent cannot approve) and written to the approvals log.
 */
const approvalSchema = z
  .object({
    by: z.string().min(2).describe('The full name of the person who approved, exactly as in the portal'),
    messageLink: z
      .string()
      .min(6)
      .describe('A link to their approving message (its permalink), or "#room/<message id>" when there is no link'),
  })
  .describe('REQUIRED for anything sent to a client: who approved it in chat, and the link to their message');

async function checkApproval(approval, action) {
  if (!approval?.by || !approval?.messageLink) {
    throw new Error(
      `${action} needs a person's approval. Ask in the room, then call again with approval: {by, messageLink}.`,
    );
  }
  const person = await findPerson(approval.by);
  if (isAgent(person)) throw new Error(`${person.name} is an agent; only a person can approve ${action}.`);
  const entry = { at: new Date().toISOString(), agent: portal.email, action, approvedBy: person.name, messageLink: approval.messageLink };
  if (APPROVALS_LOG) await appendFile(APPROVALS_LOG, `${JSON.stringify(entry)}\n`);
  return entry;
}

// ── The server ─────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: 'dhvaj-mcp', version: '0.1.0' },
  {
    instructions:
      'Tools for the Dhvaj Portal, a CA firm’s practice system. Answer ONLY from tool results: ' +
      'quote the portal’s dates (dueDate) and link the page (link). Never guess a due date, a status ' +
      'or a person. Sending to a client needs a person’s approval in chat (approval: {by, messageLink}). ' +
      'You cannot sign, issue a UDIN, lodge a filing or sign off: hand those to a partner with a link.',
  },
);

// 1. Firm brief ─────────────────────────────────────────────────────────────
server.registerTool(
  'firm_brief',
  {
    title: 'Firm brief',
    description:
      'The morning brief: dashboard counts, the risk tiles (missed filings, clients without KYC, …), ' +
      'what is overdue and what is due in the next 7 days, from the portal.',
    inputSchema: {},
  },
  tool(async () => {
    const today = istToday();
    const [summary, risk, cal] = await Promise.all([
      portal.get('/dashboard/summary'),
      portal.get('/dashboard/risk'),
      calendar({ to: addDays(today, 7) }),
    ]);
    const open = cal.filter(OPEN);
    const overdue = open.filter((i) => i.dueDate < today);
    const thisWeek = open.filter((i) => i.dueDate >= today);
    const byClient = {};
    for (const i of overdue) byClient[i.entityName] = (byClient[i.entityName] ?? 0) + 1;
    return ok({
      summary,
      riskTiles: (risk.tiles ?? []).map((t) => ({
        tile: t.key,
        count: t.count,
        top: (t.items ?? []).slice(0, 3).map((x) => `${x.title} — ${x.detail}${x.dueOn ? ` (due ${x.dueOn})` : ''}`),
        link: t.href ? pageUrl(t.href) : null,
      })),
      overdue: { count: overdue.length, byClient },
      dueThisWeek: thisWeek.map(filingRow),
      dashboard: pageUrl('/today'),
    });
  }),
);

// 2. Due list ───────────────────────────────────────────────────────────────
server.registerTool(
  'due_list',
  {
    title: 'Filings due',
    description:
      'Open filings on the compliance calendar (all 8 streams, incl. Payroll & Labour: PF ECR, ESI, PT), ' +
      'overdue first. Filter by client, stream or date range.',
    inputSchema: {
      client: z.string().optional(),
      stream: z.enum(['gst', 'tds', 'income_tax', 'roc', 'payroll', 'tax_audit', 'bookkeeping', 'mis']).optional(),
      from: z.string().optional().describe('YYYY-MM-DD; default today (overdue is always included)'),
      to: z.string().optional().describe('YYYY-MM-DD; default today + 30 days'),
      overdueOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  tool(async ({ client, stream, from, to, overdueOnly, limit = 30 }) => {
    const today = istToday();
    const ent = client ? await findClient(client) : null;
    const rows = (
      await calendar({ entityId: ent?.id, stream: stream ? [stream] : undefined, from, to: to ?? addDays(today, 30) })
    )
      .filter(OPEN)
      .filter((i) => !overdueOnly || i.dueDate < today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return ok({ client: ent?.legalName ?? 'all clients', count: rows.length, filings: rows.slice(0, limit).map(filingRow) });
  }),
);

// 3. Client status ──────────────────────────────────────────────────────────
server.registerTool(
  'client_status',
  {
    title: 'Client status',
    description:
      'Everything pending for one client: open filings (overdue and next 30 days), what we are waiting ' +
      'on from the client, and their KYC.',
    inputSchema: { client: z.string() },
  },
  tool(async ({ client }) => {
    const ent = await findClient(client);
    const today = istToday();
    const [cal, deps, kyc] = await Promise.all([
      calendar({ entityId: ent.id, to: addDays(today, 30) }),
      portal.get('/work/client-dependencies'),
      portal.get(`/entities/${ent.id}/kyc`).catch(() => null),
    ]);
    const open = cal.filter(OPEN).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const waiting = items(deps)
      .filter((d) => d.entityName === ent.legalName && d.isOpen)
      .map((d) => ({
        dependencyId: d.id,
        filingId: d.complianceInstanceId ?? null,
        what: d.requestedInfo,
        requested: d.requestDate,
        overdue: d.isOverdue,
        responsible: d.responsibleName,
        link: workItemUrl(d.link),
      }));
    return ok({
      client: ent.legalName,
      overdue: open.filter((i) => i.dueDate < today).map(filingRow),
      dueNext30Days: open.filter((i) => i.dueDate >= today).map(filingRow),
      waitingOnClient: waiting,
      kyc: kyc ? { status: kyc.status, missing: (kyc.checklist ?? []).filter((c) => c.mandatory && !c.done).map((c) => c.label) } : null,
    });
  }),
);

// 4. My work ────────────────────────────────────────────────────────────────
server.registerTool(
  'my_work',
  {
    title: 'My work',
    description:
      'The Today view for you (this agent), or the open filings assigned to a named person.',
    inputSchema: { person: z.string().optional().describe('A person’s name; omit for your own Today view') },
  },
  tool(async ({ person }) => {
    if (!person) {
      const t = await portal.get('/work/today');
      return ok({
        groups: (t.groups ?? []).map((g) => ({
          group: g.group,
          items: (g.items ?? []).slice(0, 15).map((i) => ({
            title: i.title,
            client: i.entityName,
            statutoryDate: i.filing?.statutoryDate ?? null,
            filingId: i.filing?.instanceId ?? null,
          })),
        })),
      });
    }
    const p = await findPerson(person);
    const rows = (await calendar({ to: addDays(istToday(), 30) })).filter(OPEN).filter((i) => i.assigneeName === p.name);
    return ok({ person: p.name, filings: rows.map(filingRow) });
  }),
);

// 5. Assign a filing ────────────────────────────────────────────────────────
server.registerTool(
  'assign_filing',
  {
    title: 'Assign a filing',
    description:
      'Make a person the preparer and/or reviewer of a filing (the portal’s filing-run assign). ' +
      'Pair it with give_quick_task so the person is alerted at once.',
    inputSchema: {
      ...filingRef,
      preparer: z.string().optional().describe('Name of the new preparer'),
      reviewer: z.string().optional().describe('Name of the new reviewer'),
    },
  },
  tool(async (args) => {
    if (!args.preparer && !args.reviewer) throw new Error('Say who prepares and/or who reviews.');
    const { id } = await resolveFiling(args);
    const prep = args.preparer ? await findPerson(args.preparer) : null;
    const rev = args.reviewer ? await findPerson(args.reviewer) : null;
    const result = await portal.post('/compliance/runs/assign', {
      instanceIds: [id],
      ...(prep ? { preparerId: prep.id } : {}),
      ...(rev ? { reviewerId: rev.id } : {}),
    });
    if (result.failed?.length) throw new Error(`The portal refused: ${result.failed.map((f) => f.message).join('; ')}`);
    const ws = await portal.get(`/compliance-instances/${id}`);
    return ok({ assigned: { preparer: prep?.name, reviewer: rev?.name }, filing: filingSummary(id, ws) });
  }),
);

// 6–8. Quick tasks ──────────────────────────────────────────────────────────
server.registerTool(
  'give_quick_task',
  {
    title: 'Give a quick task',
    description:
      'Give a person a quick task in the portal. It rings on their portal screen and phone at once. ' +
      'Link it to a client or filing when there is one.',
    inputSchema: {
      person: z.string(),
      title: z.string().max(500),
      details: z.string().max(4000).optional(),
      client: z.string().optional(),
      filingId: z.string().uuid().optional(),
      urgent: z.boolean().optional(),
      dueAt: z.string().optional().describe('ISO date-time'),
    },
  },
  tool(async ({ person, title, details, client, filingId, urgent = true, dueAt }) => {
    const p = await findPerson(person);
    let engagementId = null;
    let entityId = null;
    if (filingId) {
      const ws = await portal.get(`/compliance-instances/${filingId}`);
      engagementId = ws.instance.engagementId;
    }
    if (client) entityId = (await findClient(client)).id;
    const t = await portal.post('/quick-tasks', {
      title,
      details: details ?? null,
      assignedToEmployeeId: p.id,
      urgent,
      ...(engagementId ? { engagementId } : {}),
      ...(entityId ? { entityId } : {}),
      ...(dueAt ? { dueAt } : {}),
    });
    return ok({ quickTaskId: t.id, to: p.name, title: t.title, status: t.status, link: pageUrl(`/quick-tasks?task=${t.id}`) });
  }),
);

server.registerTool(
  'reply_quick_task',
  {
    title: 'Reply to a quick task',
    description: 'Answer a quick task: a message, and/or a status (received, doing, done).',
    inputSchema: {
      quickTaskId: z.string().uuid(),
      body: z.string().max(4000).optional(),
      status: z.enum(['received', 'doing', 'done']).optional(),
      etaMinutes: z.number().int().optional(),
    },
  },
  tool(async ({ quickTaskId, body, status, etaMinutes }) => {
    const t = await portal.post(`/quick-tasks/${quickTaskId}/reply`, { body, status, etaMinutes });
    return ok({ quickTaskId, status: t.status, messages: (t.messages ?? t.thread ?? []).length });
  }),
);

server.registerTool(
  'list_quick_tasks',
  {
    title: 'Quick tasks',
    description: 'Quick tasks given to you (inbox) or by you (sent), with their status.',
    inputSchema: { box: z.enum(['inbox', 'sent', 'all']).optional(), state: z.enum(['open', 'closed', 'all']).optional() },
  },
  tool(async ({ box = 'all', state = 'open' }) => {
    const r = await portal.get('/quick-tasks', { box, state });
    return ok({ quickTasks: items(r).slice(0, 30) });
  }),
);

// 9–12. Client chase ─────────────────────────────────────────────────────────
async function chaseFor(id) {
  return portal.get(`/compliance-instances/${id}/client-chase`);
}

server.registerTool(
  'chase_preview',
  {
    title: 'Draft a client reminder',
    description:
      'Draft the reminder for what a filing (or every open filing of a client) is waiting on from the ' +
      'client, in the portal’s own words, with the secure upload link. Nothing is sent: show the draft ' +
      'in the room and ask a person to approve it.',
    inputSchema: { ...filingRef },
  },
  tool(async (args) => {
    let ids = [];
    if (args.filingId || args.form) ids = [(await resolveFiling(args)).id];
    else if (args.client) {
      const ent = await findClient(args.client);
      ids = [
        ...new Set(
          items(await portal.get('/work/client-dependencies'))
            .filter((d) => d.entityName === ent.legalName && d.isOpen && d.complianceInstanceId)
            .map((d) => d.complianceInstanceId),
        ),
      ];
      if (!ids.length) return ok({ client: ent.legalName, drafts: [], note: 'Nothing is waiting on this client.' });
    } else throw new Error('Give a client or a filing.');
    const drafts = [];
    for (const id of ids) {
      const c = await chaseFor(id);
      const ws = await portal.get(`/compliance-instances/${id}`);
      drafts.push({
        filing: filingSummary(id, ws),
        waitingOn: c.waitingOn,
        channel: c.channel,
        canEmail: c.canEmail,
        canWhatsapp: c.canWhatsapp,
        reminderText: c.reminderText,
        remindersSoFar: (c.reminders ?? []).length,
      });
    }
    return ok({ drafts, next: 'Post the draft; on a person’s yes, call chase_send with their approval.' });
  }),
);

server.registerTool(
  'upload_link',
  {
    title: 'Secure upload link',
    description:
      'Make a secure, expiring upload-only link for a client request (the client uploads without logging ' +
      'in; the file lands in the filing’s slot). Share it only inside an approved reminder.',
    inputSchema: {
      dependencyId: z.string().uuid().describe('The request id (waitingOn.dependencyId / waitingOnClient.dependencyId)'),
      ttlHours: z.number().int().min(1).max(720).optional(),
    },
  },
  tool(async ({ dependencyId, ttlHours = 72 }) => {
    const dep = items(await portal.get('/work/client-dependencies')).find((d) => d.id === dependencyId);
    if (!dep) throw new Error('No open client request with that id that you can see.');
    const link = await portal
      .post(`/engagements/${dep.engagementId}/client-dependencies/${dependencyId}/upload-links`, { ttlHours })
      .catch((e) => {
        if (e.status === 403)
          e.message +=
            ' — a fresh link for an existing request needs a manager; a new request made with request_document carries its own link.';
        throw e;
      });
    return ok({
      request: dep.requestedInfo,
      client: dep.entityName,
      uploadUrl: pageUrl(`/client-upload/${link.token}`),
      expiresAt: link.expiresAt,
      maxUploads: link.maxUploads,
    });
  }),
);

server.registerTool(
  'request_document',
  {
    title: 'Ask the client for a document',
    description:
      'Open a request to the client for one of a filing’s documents (its slot, e.g. "sales register"), with ' +
      'a secure, expiring upload-only link: the client uploads without logging in and the file lands in the ' +
      'slot. Nothing is sent to the client: put the link in the reminder draft and wait for a person’s yes.',
    inputSchema: {
      ...filingRef,
      document: z.string().describe('The slot: its code (SALES_REGISTER) or words from its name ("sales register")'),
      requestedInfo: z.string().max(500).optional().describe('What exactly to send, in the client’s words'),
      ttlHours: z.number().int().min(1).max(720).optional().describe('Link life, hours (default 72)'),
    },
  },
  tool(async ({ document, requestedInfo, ttlHours = 72, ...ref }) => {
    const { id, ws } = await resolveFiling(ref);
    const want = document.trim().toLowerCase();
    const words = want.split(/\s+/);
    const slot =
      ws.slots.find((x) => x.slotCode.toLowerCase() === want.replace(/\s+/g, '_')) ??
      ws.slots.find((x) => words.every((w) => x.label.toLowerCase().includes(w)));
    if (!slot)
      return fail(`This filing has no document called "${document}".`, {
        documents: ws.slots.map((x) => ({ code: x.slotCode, name: x.label, received: x.documents.length > 0 })),
      });
    if (slot.documents.length) return fail(`${slot.label}: the client has already sent it.`, { filing: filingSummary(id, ws) });
    if (slot.openRequest?.hasLink)
      return fail(
        `${slot.label} is already requested (since ${slot.openRequest.requestedAt.slice(0, 10)}) and has its upload link. ` +
          'A fresh link for it needs a manager (upload_link); or chase it with chase_preview.',
        { dependencyId: slot.openRequest.dependencyId, filing: filingSummary(id, ws) },
      );
    const r = await portal.post(`/compliance-instances/${id}/slots/${slot.slotCode}/request`, {
      ...(requestedInfo ? { requestedInfo } : {}),
      ttlHours,
    });
    const open = r.workspace.slots.find((x) => x.slotCode === slot.slotCode)?.openRequest;
    return ok({
      requested: slot.label,
      dependencyId: open?.dependencyId ?? null,
      uploadUrl: r.link ? pageUrl(`/client-upload/${r.link.token}`) : null,
      expiresAt: r.link?.expiresAt ?? null,
      note: r.link ? undefined : 'Client upload is switched off in the portal: the request stands without a link.',
      filing: filingSummary(id, r.workspace),
      next: 'chase_preview, then post the draft with uploadUrl and wait for a person’s *send*.',
    });
  }),
);

server.registerTool(
  'chase_send',
  {
    title: 'Send the client reminder (needs approval)',
    description:
      'Send the reminder for a filing through the portal (e-mail or WhatsApp, as the firm has set up); ' +
      'the portal logs it on the filing. REQUIRES approval: {by, messageLink} from a person in the room.',
    inputSchema: {
      ...filingRef,
      channel: z.enum(['email', 'whatsapp', 'copy']).optional(),
      approval: approvalSchema,
    },
  },
  tool(async (args) => {
    const approved = await checkApproval(args.approval, 'sending a client reminder');
    const { id, ws } = await resolveFiling(args);
    const r = await portal.post(`/compliance-instances/${id}/client-chase/remind`, args.channel ? { channel: args.channel } : {});
    return ok({ sent: r, approvedBy: approved.approvedBy, approvalMessage: approved.messageLink, filing: filingSummary(id, ws) });
  }),
);

server.registerTool(
  'mark_received',
  {
    title: 'Mark a client request received',
    description: 'Record that the client has given what was asked (fully, or with items still outstanding).',
    inputSchema: {
      dependencyId: z.string().uuid(),
      fully: z.boolean(),
      outstandingItems: z.string().optional(),
    },
  },
  tool(async ({ dependencyId, fully, outstandingItems }) => {
    const dep = items(await portal.get('/work/client-dependencies')).find((d) => d.id === dependencyId);
    if (!dep) throw new Error('No open client request with that id that you can see.');
    const r = await portal.post(`/engagements/${dep.engagementId}/client-dependencies/${dependencyId}/receive`, {
      fully,
      receivedDate: istToday(),
      ...(outstandingItems ? { outstandingItems } : {}),
      version: dep.version,
    });
    return ok({ request: dep.requestedInfo, client: dep.entityName, status: r.status, link: workItemUrl(dep.link) });
  }),
);

// 13–16. Review ──────────────────────────────────────────────────────────────
server.registerTool(
  'review_inbox',
  {
    title: 'To Review inbox',
    description: 'Filings and tasks sent to you for review.',
    inputSchema: {},
  },
  tool(async () => {
    const r = await portal.get('/work/reviews');
    return ok({
      toReview: items(r).map((i) => ({
        title: i.title,
        client: i.entityName,
        filingId: i.filing?.instanceId ?? null,
        preparer: i.preparerName ?? null,
        waitingSince: i.waitingSince,
        daysWaiting: i.daysWaiting,
        statutoryDate: i.statutoryDate ?? null,
        reviewStarted: i.reviewStarted,
        link: workItemUrl(i.link),
      })),
    });
  }),
);

function figuresDiff(schema, now, last) {
  const out = [];
  for (const f of schema ?? []) {
    const a = now?.[f.key];
    const b = last?.[f.key];
    const na = a === undefined || a === null || a === '' ? null : Number(a);
    const nb = b === undefined || b === null || b === '' ? null : Number(b);
    const change = na !== null && nb !== null && nb !== 0 ? Math.round(((na - nb) / Math.abs(nb)) * 100) : null;
    out.push({ field: f.label, required: !!f.required, thisPeriod: a ?? null, lastPeriod: b ?? null, changePct: change });
  }
  return out;
}

server.registerTool(
  'compare_with_last_period',
  {
    title: 'Compare with last period',
    description:
      'Review aid: this period’s figures against last period’s, the checklist steps still open, and the ' +
      'required documents still missing. Use it before passing or returning a filing.',
    inputSchema: { ...filingRef },
  },
  tool(async (args) => {
    const { id, ws } = await resolveFiling(args);
    // The portal's last-period view (filed reference, checklist, review points)
    // carries no figures: those are on the previous filing's own workspace.
    const view = await portal.get(`/compliance-instances/${id}/last-period`).catch(() => null);
    const prev = view?.previous ?? null;
    const prevWs = prev ? await portal.get(`/compliance-instances/${prev.instanceId}`).catch(() => null) : null;
    const lastFigures = prevWs?.figures ?? null;
    const openSteps = (ws.checklist ?? []).filter((c) => c.status === 'open').map((c) => ({ step: c.label, required: c.required }));
    const missingDocs = (ws.slots ?? []).filter((s) => s.required && !(s.documents ?? []).length).map((s) => ({
      slot: s.label,
      requestedFromClient: !!s.openRequest,
    }));
    const big = figuresDiff(ws.figureSchema, ws.figures, lastFigures).filter((d) => d.changePct !== null && Math.abs(d.changePct) >= 25);
    return ok({
      filing: filingSummary(id, ws),
      lastPeriod: prev
        ? {
            period: prev.periodLabel,
            status: prev.workflowStatus,
            dueDate: prev.statutoryDueDate,
            filed: prev.filing ? { on: prev.filing.filedOn, reference: prev.filing.referenceNo, by: prev.filing.filedByName } : null,
            reviewPoints: prev.reviewPoints ?? [],
          }
        : null,
      figures: figuresDiff(ws.figureSchema, ws.figures, lastFigures),
      bigChanges: big,
      openSteps,
      missingDocuments: missingDocs,
      warnings: ws.warnings ?? [],
    });
  }),
);

async function taskMove(ws, action, body = {}) {
  const t = ws.task;
  if (!t) throw new Error('This filing has no task to review.');
  return portal.post(`/engagements/${ws.instance.engagementId}/tasks/${t.id}/${action}`, { version: t.version, ...body });
}

server.registerTool(
  'return_with_points',
  {
    title: 'Send back with review points',
    description: 'Return a filing sent for review to its preparer, with the review points to fix.',
    inputSchema: { ...filingRef, points: z.array(z.string().min(3)).min(1) },
  },
  tool(async (args) => {
    let { id, ws } = await resolveFiling(args);
    if (ws.task?.status === 'in_review' && !ws.task.reviewStartedAt) {
      await taskMove(ws, 'start-review');
      ws = await portal.get(`/compliance-instances/${id}`);
    }
    const reason = args.points.map((p, i) => `${i + 1}. ${p}`).join('\n');
    const r = await taskMove(ws, 'return', { reason });
    return ok({ returned: true, points: args.points, warnings: r?.warnings ?? [], filing: filingSummary(id, await portal.get(`/compliance-instances/${id}`)) });
  }),
);

server.registerTool(
  'pass_filing',
  {
    title: 'Pass a filing in review',
    description: 'Approve a filing sent for review (it can then be lodged by a person).',
    inputSchema: { ...filingRef, note: z.string().optional() },
  },
  tool(async (args) => {
    let { id, ws } = await resolveFiling(args);
    if (ws.task?.status === 'in_review' && !ws.task.reviewStartedAt) {
      await taskMove(ws, 'start-review');
      ws = await portal.get(`/compliance-instances/${id}`);
    }
    const r = await taskMove(ws, 'approve', args.note ? { reason: args.note } : {});
    return ok({ passed: true, warnings: r?.warnings ?? [], filing: filingSummary(id, await portal.get(`/compliance-instances/${id}`)) });
  }),
);

// 17. Sign-off request ───────────────────────────────────────────────────────
server.registerTool(
  'request_signoff',
  {
    title: 'Ask a partner to sign off',
    description:
      'Prepare a sign-off pack (what it is, figures, checks, open points) and give the partner a quick ' +
      'task linking the portal page. The partner signs in the portal; you never sign.',
    inputSchema: { ...filingRef, partner: z.string().describe('The partner’s name'), summary: z.string().max(3000) },
  },
  tool(async (args) => {
    const { id, ws } = await resolveFiling(args);
    const p = await findPerson(args.partner);
    const f = filingSummary(id, ws);
    const t = await portal.post('/quick-tasks', {
      title: `Sign-off: ${f.form} · ${f.period}`,
      details: `${args.summary}\n\nOpen in the portal: ${f.link}`,
      assignedToEmployeeId: p.id,
      engagementId: ws.instance.engagementId,
      urgent: true,
    });
    return ok({ askedPartner: p.name, quickTaskId: t.id, filing: f });
  }),
);

// ── Full tier: KYC, notices and the ITR desk, certificates, invoices ───────

/** The financial year a date falls in: '2026-11-06' → '2026-27'. */
function fyOf(iso) {
  const y = Number(iso.slice(0, 4));
  const start = Number(iso.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
/** The ITR season people mean now: last financial year's returns. */
const itrSeasonFy = () => {
  const fy = fyOf(istToday());
  const start = Number(fy.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

async function engagementsOf(entityId, kind) {
  const all = items(await portal.get('/engagements', { entityId, limit: 50 }));
  return kind ? all.filter((e) => e.kind === kind) : all;
}

// KYC ─────────────────────────────────────────────────────────────────────
server.registerTool(
  'kyc_status',
  {
    title: 'Client KYC status',
    description:
      'KYC for one client (status, risk rating, what is missing, next review), or, with no client, the ' +
      'firm’s KYC list with counts (pending, overdue reviews).',
    inputSchema: { client: z.string().optional() },
  },
  tool(async ({ client }) => {
    if (client) {
      const ent = await findClient(client);
      const kyc = await portal.get(`/entities/${ent.id}/kyc`);
      return ok({ client: ent.legalName, kyc, link: pageUrl(`/client-kyc?entity=${ent.id}`) });
    }
    const r = await portal.get('/client-kyc', { limit: 100 });
    return ok({
      counts: r.counts ?? null,
      total: r.total ?? items(r).length,
      notComplete: items(r)
        .filter((k) => k.status !== 'complete')
        .map((k) => ({ client: k.entityName, status: k.status, risk: k.riskRating, nextReviewOn: k.nextReviewOn })),
      link: pageUrl('/client-kyc'),
    });
  }),
);

// Notices and the ITR desk ─────────────────────────────────────────────────
function noticeRow(n) {
  return {
    noticeId: n.id,
    client: n.entityName,
    notice: n.noticeType?.title ?? n.noticeType?.code,
    section: n.noticeType?.section ?? null,
    referenceNo: n.referenceNo,
    issuedOn: n.issuedOn,
    amountDemanded: n.amountDemanded,
    owner: n.ownerName,
    nextDate: n.clock ? { what: n.clock.label, due: n.clock.due, daysLeft: n.clock.daysLeft, overdue: n.clock.overdue } : null,
    outcome: n.outcome,
    link: pageUrl(`/notices/${n.id}`),
  };
}

server.registerTool(
  'notice_deadlines',
  {
    title: 'Open notices and their next dates',
    description:
      'Open tax notices (income tax, GST, TDS) with the date that matters now — reply due, hearing, ' +
      'appeal window — soonest first. Optionally for one client, or only those due within N days.',
    inputSchema: { client: z.string().optional(), withinDays: z.number().int().min(0).max(365).optional() },
  },
  tool(async ({ client, withinDays }) => {
    const ent = client ? await findClient(client) : null;
    const rows = items(await portal.get('/notices', { ...(ent ? { entityId: ent.id } : {}), limit: 100 }))
      .filter((n) => !n.outcome)
      .map(noticeRow)
      .filter((n) => withinDays === undefined || (n.nextDate && n.nextDate.daysLeft <= withinDays))
      .sort((a, b) => (a.nextDate?.due ?? '9999').localeCompare(b.nextDate?.due ?? '9999'));
    return ok({ count: rows.length, notices: rows, link: pageUrl('/notices') });
  }),
);

server.registerTool(
  'notice_from_upload',
  {
    title: 'Read a notice from its uploaded PDF',
    description:
      'Given an uploaded notice document, return what the portal reads from it (OCR): GSTIN/PAN, ' +
      'reference or DIN, issue and reply dates, section, amount, the matching client and engagement. ' +
      'Nothing is saved; a person confirms and records the notice.',
    inputSchema: { documentId: z.string().uuid() },
  },
  tool(async ({ documentId }) => ok({ suggestions: await portal.post('/notices/intake', { documentId }) })),
);

async function seasonRows(financialYear) {
  const fy = financialYear ?? itrSeasonFy();
  const r = await portal.get('/itr/season', { financialYear: fy, scope: 'all' });
  return { fy, r, rows: items(r) };
}

server.registerTool(
  'everify_pending',
  {
    title: 'ITRs filed but not yet e-verified',
    description:
      'Returns on the ITR desk that are filed but still to be e-verified (a return not verified within ' +
      '30 days of filing is treated as not filed), with the e-verify deadline. Defaults to last ' +
      'financial year’s season.',
    inputSchema: { financialYear: z.string().regex(/^\d{4}-\d{2}$/).optional() },
  },
  tool(async ({ financialYear }) => {
    const { fy, r, rows } = await seasonRows(financialYear);
    const pending = rows
      // Stages: preparing → awaiting_verification → verified → processed (intimation received).
      .filter((x) => x.stage === 'awaiting_verification')
      .map((x) => ({
        returnId: x.returnId,
        client: x.entityName,
        pan: x.pan,
        filedOn: x.filedOn,
        ackNo: x.ackNo,
        eVerifyDueOn: x.eVerifyDueOn,
        overdue: x.eVerifyOverdue,
        preparer: x.preparerName,
        link: pageUrl(`/itr/${x.returnId}`),
      }))
      .sort((a, b) => String(a.eVerifyDueOn).localeCompare(String(b.eVerifyDueOn)));
    return ok({ financialYear: fy, season: r.yearLabel, pending, link: pageUrl('/itr') });
  }),
);

/** A client's ITR on the season grid (by returnId, or client name). */
async function findReturn({ returnId, client, financialYear }) {
  if (returnId) return portal.get(`/itr/returns/${returnId}`);
  if (!client) throw new Error('Give a returnId, or the client’s name.');
  const { rows } = await seasonRows(financialYear);
  const n = norm(client);
  const hits = rows.filter((x) => norm(x.entityName) === n || norm(x.entityName).includes(n));
  if (!hits.length) throw new Error(`No ITR for "${client}" on the ITR desk.`);
  if (hits.length > 1) throw new Error(`"${client}" matches ${hits.map((x) => x.entityName).join(', ')}. Say which.`);
  if (!hits[0].returnId) throw new Error(`${hits[0].entityName}'s return is not started on the ITR desk yet.`);
  return portal.get(`/itr/returns/${hits[0].returnId}`);
}

server.registerTool(
  'everify_remind',
  {
    title: 'Remind a client to e-verify (needs approval)',
    description:
      'Send the client the portal’s e-verify reminder (the firm’s channel, or e-mail/WhatsApp). ' +
      'REQUIRES approval: {by, messageLink} from a person in the room.',
    inputSchema: {
      returnId: z.string().uuid().optional(),
      client: z.string().optional(),
      channel: z.enum(['email', 'whatsapp']).optional(),
      approval: approvalSchema,
    },
  },
  tool(async (args) => {
    const approved = await checkApproval(args.approval, 'sending an e-verify reminder');
    const ret = await findReturn(args);
    const sent = await portal.post(`/itr/returns/${ret.id}/remind-verify`, args.channel ? { channel: args.channel } : {});
    return ok({ sent, approvedBy: approved.approvedBy, approvalMessage: approved.messageLink, link: pageUrl(`/itr/${ret.id}`) });
  }),
);

server.registerTool(
  'record_intimation',
  {
    title: 'Record a 143(1) intimation or 245 set-off',
    description:
      'Record an intimation received for a client’s ITR on the ITR desk: 143(1) (processed: accepted, ' +
      'refund or demand) or a 245 proposed set-off. A demand or a set-off opens a notice on the notice ' +
      'register with its reply deadline. Use the dates and reference exactly as on the intimation.',
    inputSchema: {
      returnId: z.string().uuid().optional(),
      client: z.string().optional(),
      kind: z.enum(['143_1', '245']),
      referenceNo: z.string().min(3).describe('The DIN / communication reference number'),
      issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      result: z.enum(['no_change', 'refund', 'demand']).optional(),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().describe('Refund or demand in rupees'),
      summary: z.string().max(2000).optional(),
      openNotice: z.boolean().optional().describe('Open a notice for it (default: the portal decides)'),
    },
  },
  tool(async (args) => {
    const ret = await findReturn(args);
    const r = await portal.post(`/itr/returns/${ret.id}/intimation`, {
      version: ret.version,
      kind: args.kind,
      referenceNo: args.referenceNo,
      issuedOn: args.issuedOn,
      receivedOn: args.receivedOn,
      ...(args.result ? { result: args.result } : {}),
      ...(args.amount ? { amount: args.amount } : {}),
      ...(args.summary ? { summary: args.summary } : {}),
      ...(args.openNotice !== undefined ? { openNotice: args.openNotice } : {}),
    });
    const notice = r.noticeId ? noticeRow(await portal.get(`/notices/${r.noticeId}`)) : null;
    return ok({ recorded: args.kind, client: r.return?.entityName ?? ret.entityName, notice, link: pageUrl(`/itr/${ret.id}`) });
  }),
);

// Certificates ─────────────────────────────────────────────────────────────
server.registerTool(
  'certificate_prepare',
  {
    title: 'Prepare a certificate sign-off pack',
    description:
      'Find a client’s certificates (Form 146/15CB, net worth and others) and their status and UDIN. ' +
      'With partner and summary, give the partner an urgent quick task with the pack and the portal link. ' +
      'Only a partner signs and generates the UDIN, in the portal; you never sign.',
    inputSchema: {
      client: z.string(),
      certificate: z.string().optional().describe('Which one, e.g. "15CB" or "Form 146"; default: the open ones'),
      partner: z.string().optional(),
      summary: z.string().max(3000).optional().describe('Your pack: what it certifies, key figures, checks done, open points'),
    },
  },
  tool(async ({ client, certificate, partner, summary }) => {
    const ent = await findClient(client);
    const certs = [];
    for (const e of await engagementsOf(ent.id)) {
      for (const c of items(await portal.get(`/engagements/${e.id}/certificates`).catch(() => []))) certs.push({ ...c, engagementId: e.id });
    }
    const want = certificate ? norm(certificate) : null;
    const pick = certs.filter((c) =>
      want ? [c.templateCode, c.templateName, c.formLabel].some((s) => norm(s).includes(want)) : !['issued', 'revoked'].includes(c.status),
    );
    const rows = pick.map((c) => ({
      certificateId: c.id,
      form: c.formLabel,
      name: c.templateName,
      purpose: c.purpose,
      addressee: c.addressee,
      status: c.status,
      udin: c.udin,
      figures: c.figures,
      link: pageUrl(`/engagements/${c.engagementId}?tab=certificates`),
    }));
    if (!partner) return ok({ client: ent.legalName, certificates: rows });
    if (rows.length !== 1) throw new Error(`Say which certificate: ${rows.map((r) => r.form).join(', ') || 'none open'}.`);
    if (!summary) throw new Error('Write the pack (summary) for the partner.');
    const p = await findPerson(partner);
    if (isAgent(p)) throw new Error(`${p.name} is an agent; a partner signs certificates.`);
    const c = rows[0];
    const t = await portal.post('/quick-tasks', {
      title: `Sign: ${c.form} · ${ent.legalName}`,
      details: `${summary}\n\nSign and generate the UDIN in the portal: ${c.link}`,
      assignedToEmployeeId: p.id,
      engagementId: pick[0].engagementId,
      urgent: true,
    });
    return ok({ askedPartner: p.name, quickTaskId: t.id, certificate: c });
  }),
);

// Invoices ─────────────────────────────────────────────────────────────────
async function invoiceService(client, service) {
  const ent = await findClient(client);
  const out = [];
  for (const e of await engagementsOf(ent.id)) {
    for (const s of items(await portal.get(`/engagements/${e.id}/invoice-services`).catch(() => []))) {
      out.push({ ...s, engagementId: e.id, engagementCode: e.engagementCode });
    }
  }
  const n = norm(service);
  const hits = out.filter((s) => norm(s.name).includes(n) || norm(s.stream) === n);
  if (!hits.length) throw new Error(`No "${service}" service to invoice for ${ent.legalName}. Services: ${out.map((s) => s.name).join(', ') || 'none'}.`);
  if (hits.length > 1) throw new Error(`"${service}" matches ${hits.map((s) => `${s.name} (${s.engagementCode})`).join(', ')}. Say which.`);
  return { ent, svc: hits[0] };
}

function invoiceRow(inv, engagementId) {
  return {
    invoiceId: inv.id,
    engagementId,
    number: inv.invoiceNumber,
    status: inv.status,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    taxable: inv.subtotal,
    gst: { total: inv.taxAmount, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst },
    total: inv.total,
    notes: inv.notes,
    link: pageUrl(`/engagements/${engagementId}?tab=invoices`),
  };
}

server.registerTool(
  'invoice_draft',
  {
    title: 'Draft an invoice',
    description:
      'Draft (not issue) a quick invoice for a client’s service, e.g. after a filing is lodged. A partner ' +
      'or the billing team reviews and issues it in the portal; sending it needs a person’s approval.',
    inputSchema: {
      client: z.string(),
      service: z.string().describe('The service or stream, e.g. "GST" or "Payroll"'),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/).describe('Taxable value in rupees'),
      gstRate: z.union([z.literal(0), z.literal(5), z.literal(12), z.literal(18), z.literal(28)]).optional(),
      description: z.string().max(500).optional(),
    },
  },
  tool(async ({ client, service, amount, gstRate, description }) => {
    const { ent, svc } = await invoiceService(client, service);
    const r = await portal.post(`/engagements/${svc.engagementId}/invoices/quick`, {
      engagementServiceId: svc.engagementServiceId,
      amount,
      gstRate: gstRate ?? 18,
      ...(description ? { description } : {}),
      issue: false,
    });
    return ok({
      client: ent.legalName,
      service: svc.name,
      invoice: invoiceRow(r.invoice, svc.engagementId),
      gstRate: gstRate ?? 18,
      note: `A draft: GST at ${gstRate ?? 18}% (CGST/SGST or IGST) is worked out when a person issues it in the portal.`,
    });
  }),
);

server.registerTool(
  'invoice_send',
  {
    title: 'Send an issued invoice to the client (needs approval)',
    description:
      'Send an issued invoice by e-mail or WhatsApp through the portal (logged on the invoice). Drafts ' +
      'must be issued in the portal first. REQUIRES approval: {by, messageLink} from a person.',
    inputSchema: {
      engagementId: z.string().uuid(),
      invoiceId: z.string().uuid(),
      channel: z.enum(['email', 'whatsapp', 'mail_app']),
      approval: approvalSchema,
    },
  },
  tool(async ({ engagementId, invoiceId, channel, approval }) => {
    const approved = await checkApproval(approval, 'sending an invoice');
    const r = await portal.post(`/engagements/${engagementId}/invoices/${invoiceId}/send`, { channel });
    return ok({
      sent: { channel: r.channel, to: r.to, queued: r.queued, waUrl: r.waUrl, mailtoUrl: r.mailtoUrl },
      approvedBy: approved.approvedBy,
      approvalMessage: approved.messageLink,
    });
  }),
);

await server.connect(new StdioServerTransport());
