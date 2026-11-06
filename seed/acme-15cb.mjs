// Acme Exports' Form 146 (15CB), for the #partner-signoff scene: drafted by
// the firm and sent for review, so the reviewer can check it and Partner A
// can approve and sign it in the portal with a UDIN.
//
// A certificate signed in a rehearsal stays in the register (UDINs are for
// ever), so this makes a fresh one whenever none is waiting to be signed.
// All figures are made up. Done through the portal API, as the seed does.

const items = (r) => (Array.isArray(r) ? r : (r?.items ?? []));

export const ACME_15CB = {
  templateCode: 'CERT_15CB',
  purpose: 'Remittance of freight charges to Kline Logistics GmbH, Germany',
  addressee: 'The Manager, HDFC Bank, Fort Branch, Mumbai',
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
};

/** Make sure Acme has a 15CB in review, waiting for the partner. Returns { cert, created }. */
export async function acme15cbInReview({ mp, engagementId, today }) {
  const certs = items(await mp.get(`/engagements/${engagementId}/certificates`));
  let cert = certs.find(
    (c) => c.templateCode === ACME_15CB.templateCode && ['draft', 'in_review'].includes(c.status),
  );
  const created = !cert;
  if (!cert) {
    cert = await mp.post(`/engagements/${engagementId}/certificates`, { ...ACME_15CB, asOnDate: today });
  }
  if (cert.status === 'draft') {
    cert = await mp.post(`/engagements/${engagementId}/certificates/${cert.id}/submit`, {
      version: cert.version,
    });
  }
  return { cert, created };
}
