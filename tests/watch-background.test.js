// The statuses watch in the background (probe/background.js): an alarm while a site is connected, a round on
// the alarm or right after a site is connected, only connected sites asked, and the switch in Settings.
import { check, wait, done } from './helpers/check.js';
import { makeOpera } from './helpers/opera-fake.js';

const asked = [];
const json = body => ({ type: 'basic', status: 200, headers: { get: () => 'application/json' }, json: async () => body });
globalThis.fetch = async url => {
  const { pathname } = new URL(url);
  asked.push(pathname);
  if (pathname === '/rest/api/3/myself') return json({ accountId: 'me1' });
  if (pathname === '/rest/api/3/issue/bulkfetch') {
    return json({ issues: [{ key: 'PROJ-1', fields: { status: { name: 'In Review', statusCategory: { key: 'indeterminate' } }, assignee: null } }] });
  }
  if (pathname.endsWith('/merge_requests/42')) return json({ state: 'opened', head_pipeline: { id: 5, status: 'running' } });
  if (pathname.endsWith('/merge_requests/42/approvals')) return json({ approved: false, approvals_left: 1, approved_by: [] });
  if (pathname.endsWith('/pipelines/5/jobs')) return json([{ id: 1, name: 'unit', stage: 'test', status: 'running' }]);
  return { type: 'basic', status: 404, headers: { get: () => 'application/json' }, json: async () => ({}) };
};
const MR = 'https://gitlab.example.com/group/app/-/merge_requests/42';
const o = makeOpera({
  tabs: [
    { id: 1, title: '[PROJ-1] Rate limiter - Jira', url: 'https://jira.example.com/browse/PROJ-1' },
    { id: 2, title: 'PROJ-1: Rate limiter (!42) · Merge requests · group / app · GitLab', url: MR },
  ],
  // Kept by a version that saw a change at every round: its change times mean nothing.
  local: { folders: {}, parents: {}, status: { sites: {}, tickets: { 'PROJ-1': { name: 'In Review', category: 'indeterminate', since: null, assignee: null, t0: 1, t: 5 } } } },
  granted: ['https://jira.example.com/*'],
});
await import('../probe/background.js');
await wait(300);

check('a connected site starts the watch: an alarm every 30 seconds', o.alarms.get('statuses')?.periodInMinutes === 0.5);
o.listeners.alarm({ name: 'statuses' });
await wait(300);
check(`the alarm asks the connected site about the tabs: ${JSON.stringify(o.local.status?.tickets)}`, o.local.status?.tickets?.['PROJ-1']?.name === 'In Review');
check('and no other site: GitLab is not connected', !asked.some(p => p.startsWith('/api/v4')) && !o.local.status.mrs[MR]);
check(`statuses kept before are taken as they are, without changes: ${JSON.stringify(o.local.status.tickets['PROJ-1'])}`,
  o.local.status.format === 2 && o.local.status.tickets['PROJ-1'].t0 === 5 && o.local.status.tickets['PROJ-1'].t === 5);
check('the timings stay in the session', o.session.watch?.checked?.['https://jira.example.com'] > 0 && o.session.watch.me['https://jira.example.com'] === 'me1');

o.grant('https://gitlab.example.com/*');
await wait(3500);
check('a site just connected is asked in a moment, without waiting for the alarm', o.local.status?.mrs?.[MR]?.pipeline?.status === 'running');

await o.chrome.storage.local.set({ settings: { statuses: false } });
o.listeners.alarm({ name: 'statuses' });
await wait(300);
check('switched off in Settings: the statuses are gone', Object.keys(o.local.status.tickets).length === 0 && Object.keys(o.local.status.mrs).length === 0);

o.revoke('https://jira.example.com/*');
o.revoke('https://gitlab.example.com/*');
await wait(100);
check('no site connected: the alarm stops', !o.alarms.has('statuses'));
done();
