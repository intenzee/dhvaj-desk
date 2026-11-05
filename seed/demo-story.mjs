#!/usr/bin/env node
// The Dhvaj Desk demo story: three fictional clients, the people who work on
// them, and the four agent users — created THROUGH THE PORTAL API as the
// managing partner, so every business rule, permission check and audit entry
// runs exactly as it does for staff. All names, PANs and numbers are made up.
//
//   node seed/demo-story.mjs            (portal at DHVAJ_API_URL, default :3101)
//
// Safe to re-run: anything that already exists is found and reused.

import { Portal, PortalError, istToday } from '../lib/portal.mjs';

const mp = new Portal({ email: process.env.DHVAJ_MP_EMAIL || 'mp@dhvaj.in' });
const TODAY = istToday();

// ── People ─────────────────────────────────────────────────────────────────
// Agents are portal users like anyone else. Managers may assign and review but
// can never sign: certificates, UDINs and sign-off are partner-only in the
// portal, so "people hold the pen" is enforced by the portal itself.
const PEOPLE = [
  { key: 'riya', email: 'riya@dhvaj.demo', name: 'Riya Kapoor', roles: ['article'] },
  { key: 'desk', email: 'agent-desk@dhvaj.demo', name: 'dhvaj-desk (agent)', roles: ['manager'] },
  { key: 'chaser', email: 'agent-chaser@dhvaj.demo', name: 'dhvaj-chaser (agent)', roles: ['senior'] },
  { key: 'reviewer', email: 'agent-reviewer@dhvaj.demo', name: 'dhvaj-reviewer (agent)', roles: ['manager'] },
  { key: 'notices', email: 'agent-notices@dhvaj.demo', name: 'dhvaj-notices (agent)', roles: ['senior'] },
];
const PARTNER_EMAIL = 'partner.a@dhvaj.in';
const MANAGER_EMAIL = 'manager.x@dhvaj.in';
const KYC_OVERRIDE = 'Demo client: KYC documents are being collected (Dhvaj Desk story).';

// ── Helpers ────────────────────────────────────────────────────────────────
const log = (...a) => console.log('[demo-story]', ...a);

async function step(label, fn) {
  try {
    const out = await fn();
    log(`✓ ${label}`);
    return out;
  } catch (e) {
    log(`✗ ${label}: ${e.message}`);
    throw e;
  }
}

const items = (r) => (Array.isArray(r) ? r : (r?.items ?? []));

/** GSTIN = state code + PAN + entity no. + 'Z' + check character (mod-36). */
function gstin(state, pan, n = '1') {
  const base = `${state}${pan}${n}Z`;
  const cs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  [...base].forEach((ch, i) => {
    const v = cs.indexOf(ch) * (i % 2 ? 2 : 1);
    sum += Math.floor(v / 36) + (v % 36);
  });
  return base + cs[(36 - (sum % 36)) % 36];
}

/** Months 'YYYY-MM' from..to inclusive. */
function months(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

async function employeesByEmail() {
  const map = new Map();
  for (let offset = 0; ; offset += 100) {
    const page = await mp.get('/employees', { limit: 100, offset });
    for (const e of items(page)) if (e.userEmail) map.set(e.userEmail.toLowerCase(), e);
    if (items(page).length < 100) break;
  }
  return map;
}

async function ensureUser(p) {
  try {
    await mp.post('/users', { email: p.email, displayName: p.name, officeCode: 'NORTH', roles: p.roles });
    return 'created';
  } catch (e) {
    if (e instanceof PortalError && e.status === 409) return 'exists';
    throw e;
  }
}

async function findEntity(legalName) {
  const r = await mp.get('/entities', { search: legalName, limit: 20 });
  return items(r).find((e) => (e.legalName ?? e.legal_name) === legalName) ?? null;
}

async function ensureEntity(spec) {
  const found = await findEntity(spec.legalName);
  const entity =
    found ??
    (await mp.post('/entities', {
      legalName: spec.legalName,
      typeSlug: spec.typeSlug,
      officeCode: 'NORTH',
      pan: spec.pan,
    }));
  const detail = await mp.get(`/entities/${entity.id}`);
  const have = new Set((detail.registrations ?? []).map((r) => r.registrationType));
  for (const reg of spec.registrations ?? []) {
    if (have.has(reg.registrationType)) continue;
    await mp.post(`/entities/${entity.id}/registrations`, { status: 'active', isPrincipal: true, ...reg });
  }
  return mp.get(`/entities/${entity.id}`);
}

async function engagementsFor(entityId) {
  return items(await mp.get('/engagements', { entityId, limit: 50 }));
}

async function ensureEngagement(entity, body, match) {
  const existing = (await engagementsFor(entity.id)).find(match);
  if (existing) return existing;
  return mp.post('/engagements', {
    entityId: entity.id,
    kycOverrideReason: KYC_OVERRIDE,
    ...body,
  });
}

async function calendarFor(entityName) {
  const r = await mp.get('/compliance/calendar', { from: '2026-04-01', to: '2027-03-31' });
  return items(r).filter((i) => i.entityName === entityName);
}

// ── The story ──────────────────────────────────────────────────────────────
async function main() {
  log(`portal ${mp.url}, today ${TODAY} (IST)`);

  for (const p of PEOPLE) await step(`user ${p.email}`, () => ensureUser(p));
  const emp = await employeesByEmail();
  const id = (email) => {
    const e = emp.get(email);
    if (!e) throw new Error(`no employee for ${email}`);
    return e.id;
  };
  const partner = id(PARTNER_EMAIL);
  const manager = id(MANAGER_EMAIL);
  const agents = ['desk', 'chaser', 'reviewer', 'notices'].map((k) => id(PEOPLE.find((p) => p.key === k).email));
  const riya = id('riya@dhvaj.demo');
  const team = [riya, ...agents];

  // 1. Sharma Traders — GST and the Payroll & Labour stream (PF, ESI, PT).
  const sharmaPan = 'AAHFS4821K';
  const sharma = await step('client Sharma Traders', () =>
    ensureEntity({
      legalName: 'Sharma Traders',
      typeSlug: 'partnership',
      pan: sharmaPan,
      registrations: [
        { registrationType: 'gstin', registrationNumber: gstin('27', sharmaPan), stateCode: '27' },
        { registrationType: 'pf', registrationNumber: 'MHBAN0048213000' },
        { registrationType: 'esic', registrationNumber: '31000482130001001' },
        { registrationType: 'pt', registrationNumber: '27482130981P', stateCode: '27' },
      ],
    }),
  );
  const sharmaEng = await step('Sharma compliance engagement (GST + Payroll & Labour)', () =>
    ensureEngagement(
      sharma,
      {
        kind: 'compliance',
        financialYear: '2026-27',
        engagementPartnerEmployeeId: partner,
        engagementManagerEmployeeId: manager,
        teamMemberEmployeeIds: team,
        streams: ['gst', 'payroll'],
        // dhvaj-desk leads both streams, so (with the firm's "managers and
        // stream leads" assign policy) it can hand out these filings — and
        // nothing more: signing and lodging stay with people.
        streamLeads: { gst: agents[0], payroll: agents[0] },
        // Filed before the portal: April–August. September is overdue and
        // October is this month's work.
        priorFiled: { gst: months('2026-04', '2026-08'), payroll: months('2026-04', '2026-08') },
      },
      (e) => e.kind === 'compliance',
    ),
  );
  await step('Sharma: October GSTR-1 waiting on the client’s sales register', async () => {
    // Requested through the filing's own slot: the portal opens the client
    // dependency and a secure upload link, and the upload ticks the step.
    const cal = await mp.get('/compliance/calendar', { engagementId: sharmaEng.id, from: '2026-11-01', to: '2026-11-30' });
    const gstr1 = items(cal).find((i) => i.formLabel === 'GSTR-1' && i.periodKey === '2026-10');
    if (!gstr1) throw new Error('no October GSTR-1 on the calendar');
    const ws = await mp.get(`/compliance-instances/${gstr1.id}`);
    const slot = ws.slots.find((s) => s.slotCode === 'SALES_REGISTER');
    if (slot.openRequest || slot.documents.length) return;
    await mp.post(`/compliance-instances/${gstr1.id}/slots/SALES_REGISTER/request`, {
      requestedInfo: 'Sales register for October 2026 (all invoices, as Excel)',
      ttlHours: 72,
    });
  });

  // 2. Acme Exports — a Form 146 (was 15CB) certificate for a foreign remittance.
  const acme = await step('client Acme Exports Pvt Ltd', () =>
    ensureEntity({ legalName: 'Acme Exports Pvt Ltd', typeSlug: 'private_limited', pan: 'AAECA7310M' }),
  );
  const certService = items(await mp.get('/services', { limit: 100, search: 'CERTIFICATION' })).find((s) => s.code === 'CERTIFICATION');
  if (!certService) throw new Error('CERTIFICATION service not found');
  const acmeEng = await step('Acme certification engagement', () =>
    ensureEngagement(
      acme,
      {
        kind: 'assignment',
        serviceId: certService.id,
        financialYear: '2026-27',
        engagementPartnerEmployeeId: partner,
        engagementManagerEmployeeId: manager,
        teamMemberEmployeeIds: team,
      },
      (e) => e.kind === 'assignment',
    ),
  );
  await step('Acme: Form 146 (15CB) drafted and sent for review', async () => {
    const certs = items(await mp.get(`/engagements/${acmeEng.id}/certificates`));
    const cert =
      certs.find((c) => c.templateCode === 'CERT_15CB') ??
      (await mp.post(`/engagements/${acmeEng.id}/certificates`, {
      templateCode: 'CERT_15CB',
      purpose: 'Remittance of freight charges to Kline Logistics GmbH, Germany',
      addressee: 'The Manager, HDFC Bank, Fort Branch, Mumbai',
      asOnDate: TODAY,
      figures: {
        remitter_name: 'Acme Exports Pvt Ltd',
        remitter_pan: 'AAECA7310M',
        remittee_name: 'Kline Logistics GmbH',
        remittee_country: 'Germany',
        nature_of_remittance: 'Ocean freight for export shipments (invoice KL-2026-1182)',
        purpose_code: 'S0221',
        currency: 'EUR',
        amount_fcy: 12000,
        amount_inr: '1086000',
        bank_name: 'HDFC Bank',
        bsr_code: '0510308',
        remittance_date: '2026-11-10',
        taxable_in_india: 'no',
        provision: 'Article 8 of the India–Germany DTAA: shipping profits taxable only in Germany',
        trc_obtained: 'yes',
        tds_rate: 0,
        tds_amount: '0',
        remarks: 'TRC and Form 10F on file; no PE in India.',
      },
    }));
    if (cert.status === 'draft') {
      await mp.post(`/engagements/${acmeEng.id}/certificates/${cert.id}/submit`, { version: cert.version });
    }
  });

  // 3. The Mehta family — ITRs for AY 2026-27 (FY 2025-26).
  for (const m of [
    { name: 'Anil Mehta', pan: 'ABQPM4321K', eVerified: true },
    { name: 'Sunita Mehta', pan: 'AGRPM8812L', eVerified: false },
  ]) {
    const ent = await step(`client ${m.name}`, () =>
      ensureEntity({ legalName: m.name, typeSlug: 'individual', pan: m.pan }),
    );
    const eng = await step(`${m.name}: income-tax engagement FY 2025-26`, () =>
      ensureEngagement(
        ent,
        {
          kind: 'compliance',
          financialYear: '2025-26',
          engagementPartnerEmployeeId: partner,
          engagementManagerEmployeeId: manager,
          teamMemberEmployeeIds: team,
          streams: ['income_tax'],
          streamLeads: { income_tax: manager },
        },
        (e) => e.kind === 'compliance',
      ),
    );
    await step(`${m.name}: ITR filed${m.eVerified ? ' and e-verified' : ', e-verification pending'}`, async () => {
      // The ITR desk's season grid has one row per return item on the calendar.
      const season = await mp.get('/itr/season', { financialYear: '2025-26', scope: 'all' });
      const row = items(season).find((r) => r.engagementId === eng.id);
      if (!row) throw new Error('no ITR item on the season grid');
      const returnId = row.returnId ?? (await mp.post('/itr/returns', { complianceInstanceId: row.instanceId })).id;
      // A return is filed by lodging its calendar item, like any other filing.
      if (row.workflowStatus !== 'filed') {
        await mp.post(`/compliance-instances/${row.instanceId}/lodge`, {
          referenceKind: 'ack',
          referenceNo: m.eVerified ? '284719350240726' : '284719366110726',
          filedOn: '2026-07-24',
        });
      }
      const ret = await mp.get(`/itr/returns/${returnId}`);
      if (m.eVerified && !ret.eVerifiedOn) {
        await mp.post(`/itr/returns/${returnId}/e-verify`, {
          version: ret.version,
          eVerifiedOn: '2026-07-25',
          mode: 'aadhaar_otp',
        });
      }
    });
  }

  // 4. What the desk sees now.
  const summary = await mp.get('/dashboard/summary');
  log('dashboard:', JSON.stringify(summary));
  for (const name of ['Sharma Traders']) {
    const open = (await calendarFor(name)).filter((i) => i.workflowStatus !== 'filed');
    log(`${name} open filings:`, open.map((i) => `${i.formLabel} ${i.periodLabel} due ${i.dueDate}`).join(' · '));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
