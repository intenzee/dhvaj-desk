// Sharma Traders' GSTR-3B story, for the #review-queue scene:
//
//   - September 2026 was filed late (24 Oct, ARN on record) with its figures.
//   - October 2026 is prepared by Riya: figures in, liability, ITC, client
//     approval and payment ticked. Its ITC is about 40% above September's
//     while sales grew about 5% — the gap a reviewer should catch and send
//     back for a GSTR-2B reconciliation.
//
// All figures are made up. Done through the portal API, as the seed does.

const items = (r) => (Array.isArray(r) ? r : (r?.items ?? []));

export const SEPTEMBER = {
  output_igst: '18400', output_cgst: '41250', output_sgst: '41250', output_cess: '0',
  itc_igst: '9600', itc_cgst: '28100', itc_sgst: '28100', itc_cess: '0',
  cash_igst: '8800', cash_cgst: '13150', cash_sgst: '13150', cash_cess: '0',
  interest_paid: '310', late_fee_paid: '200', closing_credit: '0',
};
export const OCTOBER = {
  output_igst: '19300', output_cgst: '43200', output_sgst: '43200', output_cess: '0',
  itc_igst: '13400', itc_cgst: '39350', itc_sgst: '39350', itc_cess: '0',
  cash_igst: '5900', cash_cgst: '3850', cash_sgst: '3850', cash_cess: '0',
  interest_paid: '0', late_fee_paid: '0', closing_credit: '0',
};

const same = (a, b) => Object.keys(b).every((k) => Number(a?.[k]) === Number(b[k]));

async function saveFigures(who, id, figures) {
  const ws = await who.get(`/compliance-instances/${id}`);
  if (same(ws.figures, figures)) return ws;
  // The first save carries no version; later ones the version they replace.
  return who.put(`/compliance-instances/${id}/figures`, { figures, ...(ws.figuresVersion ? { version: ws.figuresVersion } : {}) });
}

async function tick(who, id, codes) {
  for (const code of codes) {
    const ws = await who.get(`/compliance-instances/${id}`);
    const item = ws.checklist.find((c) => c.itemCode === code);
    if (!item || item.status === 'done') continue;
    await who.patch(`/compliance-instances/${id}/items/${item.id}`, { status: 'done', version: item.version });
  }
}

/** @param {{mp: import('../lib/portal.mjs').Portal, riya: import('../lib/portal.mjs').Portal, entityId: string}} p */
export async function sharmaGst3b({ mp, riya, entityId, log = console.log }) {
  const cal = items(await mp.get('/compliance/calendar', { entityId, includeOverdue: true, from: '2026-04-01', to: '2026-12-31' }));
  const of = (pk) => cal.find((i) => i.formLabel === 'GSTR-3B' && i.periodKey === pk)?.id;
  const sep = of('2026-09');
  const oct = of('2026-10');
  if (!sep || !oct) throw new Error('no September/October GSTR-3B on Sharma Traders’ calendar');

  // September: figures, then lodged late by the partner's office.
  const sepWs = await mp.get(`/compliance-instances/${sep}`);
  if (sepWs.instance.workflowStatus !== 'filed') {
    await saveFigures(mp, sep, SEPTEMBER);
    await tick(mp, sep, ['LIABILITY', 'ITC_CONFIRMED', 'INTEREST_FEE', 'CLIENT_APPROVAL', 'PAYMENT', 'REVIEW']);
    await mp.post(`/compliance-instances/${sep}/lodge`, {
      referenceKind: 'arn',
      referenceNo: 'AA2709260481273',
      filedOn: '2026-10-24',
    });
    log('✓ Sharma: September GSTR-3B filed (24 Oct, late) with its figures');
  }

  // October: Riya's figures and steps.
  await saveFigures(riya, oct, OCTOBER);
  await tick(riya, oct, ['LIABILITY', 'ITC_CONFIRMED', 'CLIENT_APPROVAL', 'PAYMENT']);
  log('✓ Sharma: October GSTR-3B prepared (ITC ~40% above September)');
  return { sep, oct };
}
