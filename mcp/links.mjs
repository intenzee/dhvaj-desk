// Deep links into the portal web app, mirroring the portal's own
// workItemHref (packages/contracts/src/work-links.ts) so a link an agent posts
// opens the exact filing, task or client request.

const WEB = () => (process.env.DHVAJ_WEB_URL || 'http://localhost:3100').replace(/\/$/, '');

const NO_FILING_TAB = { compliance: 'services', assignment: 'work', statutory_audit: 'audit_file' };

function financialYearOfPeriod(periodKey) {
  const k = periodKey ? /^(\d{4})-(\d{2})([-:].+)?$/.exec(periodKey) : null;
  if (!k) return null;
  const year = Number(k[1]);
  const two = Number(k[2]);
  if (two === (year + 1) % 100) return `${k[1]}-${k[2]}`;
  if (k[3] || two < 1 || two > 12) return null;
  const start = two >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** @param {Record<string, any>} ref the `link` object the API returns on a row */
export function workItemUrl(ref) {
  if (!ref) return null;
  if (ref.noticeId) return `${WEB()}/notices/${ref.noticeId}`;
  if (ref.udinId) return `${WEB()}/registers/udin?u=${encodeURIComponent(ref.udinId)}`;
  if (!ref.engagementId) return null;
  const p = new URLSearchParams();
  const filing = Boolean(ref.instanceId || (ref.stream && ref.periodKey));
  if (filing) {
    p.set('tab', ref.stream ?? 'compliance');
    const fy = ref.financialYear ?? financialYearOfPeriod(ref.periodKey);
    if (fy) p.set('fy', fy);
    if (ref.stream && ref.registrationNumber) p.set('gstin', ref.registrationNumber);
    if (ref.periodKey) {
      const m = ref.stream === 'gst' ? /^\d{4}-(\d{2})$/.exec(ref.periodKey) : null;
      if (m) p.set('m', String(Number(m[1])));
      else p.set('p', ref.periodKey);
    }
    if (ref.section) p.set('part', ref.section);
  } else if (ref.taskId) {
    p.set('tab', NO_FILING_TAB[ref.engagementKind] ?? 'overview');
  }
  if (ref.taskId) p.set('task', ref.taskId);
  if (ref.requestId) p.set('request', ref.requestId);
  const q = p.toString();
  return `${WEB()}/engagements/${ref.engagementId}${q ? `?${q}` : ''}`;
}

export const pageUrl = (path) => `${WEB()}${path}`;
