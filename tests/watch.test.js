// The statuses watch (pollSites in probe/integrations.js): what one round asks each site, what it keeps, when each
// page is due again, and how a signed-out, unreachable or missing page is handled. A fake network, a fake clock.
import { check, done } from './helpers/check.js';
import { detectSites, pollSites, statusLines, describeWatched, CADENCE } from '../probe/integrations.js';
import { asStored } from './helpers/stored.js';

const tab = (title, url) => ({ title, url });
const json = body => ({ type: 'basic', status: 200, headers: { get: () => 'application/json' }, json: async () => body });
const status = code => ({ type: 'basic', status: code, headers: { get: () => 'application/json' }, json: async () => ({ message: `${code}` }) });
const J = 'https://jira.example.com';
const G = 'https://gitlab.example.com';
const P = '/api/v4/projects/group%2Fapp';
const MR42 = `${G}/group/app/-/merge_requests/42`;
const MR43 = `${G}/group/app/-/merge_requests/43`;
const T = Date.parse('2026-09-30T12:00:00Z');

const tabs = [
  tab('[PROJ-1] Rate limiter - Jira', `${J}/browse/PROJ-1`),
  tab('[PROJ-2] Ledger - Jira', `${J}/browse/PROJ-2`),
  tab('PROJ-1: Rate limiter (!42) · Merge requests · group / app · GitLab', `${MR42}/diffs`),
  tab('PROJ-2: Ledger (!43) · Merge requests · group / app · GitLab', MR43),
  tab('Pipeline · group / app · GitLab', `${G}/group/app/-/pipelines/900`),
  tab('rpm-tests (#31) · Jobs · group / app · GitLab', `${G}/group/app/-/jobs/31`),
  tab('nightly #128 [Jenkins]', 'https://ci.example.com/job/nightly/128/console'),
  tab('nightly [Jenkins]', 'https://ci.example.com/job/nightly/'),
];

// The sites' answers by path; each round may change them. Every request is logged.
let routes;
let log = [];
const network = async (url, init) => {
  const { pathname } = new URL(url);
  log.push(`${init.method ?? 'GET'} ${pathname}`);
  const answer = routes[pathname];
  if (!answer) return status(404);
  return typeof answer === 'function' ? answer(init) : answer;
};
const jobsRunning = [
  { id: 1, name: 'build', stage: 'build', status: 'success' },
  { id: 2, name: 'unit', stage: 'test', status: 'running' },
  { id: 3, name: 'lint', stage: 'test', status: 'success' },
  { id: 4, name: 'deploy', stage: 'deploy', status: 'created' },
];
routes = {
  '/rest/api/3/myself': json({ accountId: 'me1' }),
  '/rest/api/3/issue/bulkfetch': json({
    issues: [
      { key: 'PROJ-1', fields: { status: { name: 'In Review', statusCategory: { key: 'indeterminate' } }, statuscategorychangedate: '2026-09-28T10:00:00.000+0300', assignee: { accountId: 'me1', displayName: 'Me' } } },
      { key: 'PROJ-2', fields: { status: { name: 'Done', statusCategory: { key: 'done' } }, assignee: null } },
    ],
    issueErrors: [],
  }),
  [`${P}/merge_requests/42`]: json({
    state: 'opened', draft: false, detailed_merge_status: 'ci_still_running', has_conflicts: false, blocking_discussions_resolved: true,
    head_pipeline: { id: 901, status: 'running', started_at: '2026-09-30T11:58:00Z', duration: null },
  }),
  [`${P}/merge_requests/42/approvals`]: json({ approved: false, approvals_left: 1, approved_by: [] }),
  [`${P}/pipelines/901/jobs`]: json(jobsRunning),
  [`${P}/merge_requests/43`]: json({ state: 'merged', draft: false, detailed_merge_status: 'not_open', head_pipeline: { id: 950, status: 'success', detailed_status: { group: 'success-with-warnings' } } }),
  [`${P}/pipelines/950/jobs`]: json([
    { id: 10, name: 'build', stage: 'build', status: 'success' },
    { id: 11, name: 'flaky', stage: 'test', status: 'failed', allow_failure: true },
  ]),
  [`${P}/pipelines/900`]: json({ id: 900, status: 'failed', started_at: '2026-09-30T11:00:00Z', duration: 300 }),
  [`${P}/pipelines/900/jobs`]: json([
    { id: 20, name: 'build', stage: 'build', status: 'success' },
    { id: 21, name: 'unit-tests', stage: 'test', status: 'failed' },
  ]),
  [`${P}/jobs/31`]: json({ status: 'failed', name: 'rpm-tests', stage: 'test', allow_failure: false, started_at: '2026-09-30T11:10:00Z', duration: 120 }),
  '/job/nightly/api/json': json({
    name: 'nightly',
    builds: [
      { number: 128, building: true, result: null, timestamp: T - 60_000, estimatedDuration: 150_000, duration: 0 },
      { number: 127, building: false, result: 'UNSTABLE', timestamp: T - 86_400_000, estimatedDuration: 150_000, duration: 660_000 },
    ],
  }),
};

const sites = detectSites(tabs, Infinity);
const round = async (now, over = {}) => {
  log = [];
  // What the last round kept comes back from storage, as it would in Opera.
  const r = await pollSites({ sites: over.sites ?? sites, previous: over.previous ?? asStored(state.status), memo: over.memo ?? asStored(state.memo), now, fetch: network, timeout: 1000 });
  state = r;
  return r;
};
let state = { status: {}, memo: {} };

// ---- the first round asks for everything ----
let r = await round(T);
check(`the first round asks every site about every page: ${log.length} requests`, log.length === 12);
check('Jira: who you are once, then every ticket in one bulk request', log.filter(l => l.includes('/rest/api/3')).join() === 'GET /rest/api/3/myself,POST /rest/api/3/issue/bulkfetch');
check(`tickets: the status, its category and since when, and whether it is on you: ${JSON.stringify(r.status.tickets['PROJ-1'])}`,
  r.status.tickets['PROJ-1'].name === 'In Review' && r.status.tickets['PROJ-1'].category === 'indeterminate' && r.status.tickets['PROJ-1'].assignee.me === true
  && r.status.tickets['PROJ-1'].since === Date.parse('2026-09-28T07:00:00Z')
  && r.status.tickets['PROJ-2'].category === 'done' && r.status.tickets['PROJ-2'].assignee === null && r.status.tickets['PROJ-1'].t === T && r.status.tickets['PROJ-1'].t0 === T);
const mr = r.status.mrs[MR42];
check(`a merge request: state, merge status, approvals: ${mr.state} ${mr.merge} ${mr.approved}/${mr.approvalsLeft}`,
  mr.state === 'opened' && mr.merge === 'ci_still_running' && mr.approved === false && mr.approvalsLeft === 1 && mr.approvedBy === 0);
check(`its pipeline, with stages and jobs: ${JSON.stringify(mr.pipeline.stages)}`,
  mr.pipeline.status === 'running' && mr.pipeline.stages.map(s => `${s.name}:${s.status}`).join() === 'build:success,test:running,deploy:pending'
  && mr.pipeline.jobs.total === 4 && mr.pipeline.jobs.success === 2 && mr.pipeline.jobs.running === 1 && mr.pipeline.jobs.pending === 1 && mr.pipeline.running.join() === 'unit');
check(`each stage with its jobs: ${JSON.stringify(mr.pipeline.stages[1])}`,
  JSON.stringify(mr.pipeline.stages[1]) === JSON.stringify({ name: 'test', status: 'running', done: 1, total: 2, failed: [], running: [{ name: 'unit', startedAt: null }] }));
const merged = r.status.mrs[MR43];
check('a merged one: no approvals asked, its pipeline passed with a warning',
  merged.state === 'merged' && merged.approved === null && !log.includes(`GET ${P}/merge_requests/43/approvals`) && merged.pipeline.status === 'success' && merged.pipeline.warnings && merged.pipeline.jobs.warnings === 1);
const pipeline = r.status.pipelines[`${G}/group/app/-/pipelines/900`];
check(`a pipeline tab: failed, and which job: ${pipeline.failed}`, pipeline.status === 'failed' && pipeline.failed.join() === 'unit-tests' && pipeline.stages.map(s => s.status).join() === 'success,failed');
check('a job tab', r.status.jobs[`${G}/group/app/-/jobs/31`].status === 'failed' && r.status.jobs[`${G}/group/app/-/jobs/31`].name === 'rpm-tests');
const build = r.status.builds['https://ci.example.com/job/nightly/128/'];
check(`a Jenkins build, with its job and the builds before it: ${JSON.stringify(build.recent)}`,
  build.building && build.estimate === 150_000 && build.job === 'nightly' && build.recent.length === 1 && build.recent[0].number === 127 && build.recent[0].result === 'UNSTABLE');
check('a Jenkins job by its last build, both from one request per job',
  r.status.projects['https://ci.example.com/job/nightly/'].number === 128 && log.filter(l => l.startsWith('GET /job/')).join() === 'GET /job/nightly/api/json,GET /job/nightly/api/json');
check('every site answered', Object.values(r.status.sites).every(s => s.ok) && Object.keys(r.status.sites).length === 3 && r.memo.checked[J] === T);
check('who you are on Jira is remembered', r.memo.me[J] === 'me1');
const due = id => r.memo.due[id] - T;
check(`due again: 30 s while running, 2 min while open, 15 min once over`,
  due(`mrs ${MR42}`) === CADENCE.active && due(`mrs ${MR43}`) === CADENCE.done && due('tickets PROJ-1') === CADENCE.open && due('tickets PROJ-2') === CADENCE.done
  && due(`jobs ${G}/group/app/-/jobs/31`) === CADENCE.done && due('builds https://ci.example.com/job/nightly/128/') === CADENCE.active);
check('the statuses changed', r.changed);

const lines = statusLines(tabs[2], r.status, T);
check(`a tab's lines, for its tooltip:\n  ${lines.join('\n  ')}`, lines.join('\n') === [
  'Merge request !42: open · pipeline running, stage test, 2 of 4 jobs done · 1 approval left',
  'PROJ-1: In Review (In Progress) · on you',
].join('\n'));
check(`a build's: ${statusLines(tabs[6], r.status, T)}`, statusLines(tabs[6], r.status, T).join() === 'Build #128: building, about 40%');

check('a status named like its category says it once; no word about approvals nobody asked for',
  describeWatched('tickets', 'PROJ-5', { name: 'In Progress', category: 'indeterminate', assignee: null }) === 'PROJ-5: In Progress · unassigned'
  && describeWatched('mrs', MR42, { state: 'opened', draft: false, merge: 'need_rebase', approved: false, approvalsLeft: null, approvedBy: null, pipeline: null }) === 'Merge request !42: open · no pipeline · needs a rebase');

// ---- nothing is due: nothing is asked ----
r = await round(T + 10_000);
check(`ten seconds later nothing is due: ${log.length} requests, nothing changed`, log.length === 0 && !r.changed && r.status.tickets['PROJ-1'].t === T);

// ---- the running things are asked again after 30 s ----
routes[`${P}/merge_requests/42`] = json({ state: 'opened', draft: false, detailed_merge_status: 'mergeable', has_conflicts: false, blocking_discussions_resolved: true, head_pipeline: { id: 901, status: 'success', started_at: '2026-09-30T11:58:00Z', duration: 180 } });
routes[`${P}/pipelines/901/jobs`] = json(jobsRunning.map(j => ({ ...j, status: 'success' })));
routes[`${P}/merge_requests/42/approvals`] = json({ approved: true, approvals_left: 0, approved_by: [{ user: { name: 'Someone' } }] });
routes['/job/nightly/api/json'] = json({
  name: 'nightly',
  builds: [
    { number: 128, building: false, result: 'SUCCESS', timestamp: T - 60_000, estimatedDuration: 150_000, duration: 140_000 },
    { number: 127, building: false, result: 'UNSTABLE', timestamp: T - 86_400_000, estimatedDuration: 150_000, duration: 660_000 },
  ],
});
r = await round(T + 31_000);
check(`after 30 s only what runs is asked again: ${log.join(', ')}`,
  log.length === 5 && log.includes(`GET ${P}/merge_requests/42`) && log.includes(`GET ${P}/pipelines/901/jobs`) && log.includes('GET /job/nightly/api/json'));
check('the merge request is ready now, and changed at this round; it was first known at the first',
  r.status.mrs[MR42].pipeline.status === 'success' && r.status.mrs[MR42].merge === 'mergeable' && r.status.mrs[MR42].t === T + 31_000 && r.status.mrs[MR42].t0 === T);
check('what was not asked keeps its time', r.status.tickets['PROJ-1'].t === T && r.changed);
check(`and reads so: ${statusLines(tabs[2], r.status)[0]}`, statusLines(tabs[2], r.status)[0] === 'Merge request !42: open · pipeline passed · approved by 1 · ready to merge');
check(`a pipeline tab's and a job tab's: ${statusLines(tabs[4], r.status)}; ${statusLines(tabs[5], r.status)}`,
  statusLines(tabs[4], r.status).join() === 'Pipeline #900: failed: unit-tests' && statusLines(tabs[5], r.status).join() === 'Job #31 rpm-tests: failed, stage test');

// ---- a finished pipeline's jobs aren't asked for again ----
r = await round(T + 31_000 + CADENCE.open + 1);
check(`two minutes on, the open merge request and the tickets, but not the finished pipeline's jobs: ${log.join(', ')}`,
  log.includes(`GET ${P}/merge_requests/42`) && !log.includes(`GET ${P}/pipelines/901/jobs`) && log.includes('POST /rest/api/3/issue/bulkfetch') && !log.includes('GET /rest/api/3/myself'));
check('the same answers change nothing', !r.changed && r.status.mrs[MR42].t === T + 31_000);

// ---- a site that signed out rests, and keeps what it knew ----
const signedOut = { ...routes };
for (const path of Object.keys(signedOut)) if (path.startsWith('/api/v4')) signedOut[path] = status(401);
const kept = routes;
routes = signedOut;
const later = T + CADENCE.done + 60_000;
r = await round(later);
check(`GitLab signed out: ${JSON.stringify(r.status.sites[G])}`, r.status.sites[G].ok === false && r.status.sites[G].error === 'signed out');
check('its statuses stay as they were', r.status.mrs[MR42]?.pipeline.status === 'success' && r.status.pipelines[`${G}/group/app/-/pipelines/900`]?.status === 'failed');
check('and it rests 5 minutes', r.memo.due[`site ${G}`] === later + CADENCE.signedOut);
r = await round(later + 60_000);
check(`a minute on, GitLab isn't asked: ${log.filter(l => l.includes('/api/v4')).length} requests`, !log.some(l => l.includes('/api/v4')) && r.status.sites[G].error === 'signed out');
routes = kept;
r = await round(later + CADENCE.signedOut + 1_000);
check('once it rests enough and answers again, it is back', r.status.sites[G].ok === true && log.some(l => l.includes('/api/v4')));

// ---- no network: rest 2 minutes; a gone page: 15 minutes, and nothing kept ----
const offline = async (url, init) => {
  if (url.startsWith('https://ci.example.com')) throw new TypeError('Failed to fetch');
  return network(url, init);
};
state.memo.due = {};
r = await pollSites({ sites, previous: state.status, memo: state.memo, now: later + 3_600_000, fetch: offline, timeout: 1000 });
check(`Jenkins unreachable: ${JSON.stringify(r.status.sites['https://ci.example.com'])}`,
  r.status.sites['https://ci.example.com'].error === 'offline' && r.memo.due['site https://ci.example.com'] === later + 3_600_000 + CADENCE.offline && r.status.builds['https://ci.example.com/job/nightly/128/']);
state = r;
delete routes[`${P}/jobs/31`];
state.memo.due = {};
r = await round(later + 7_200_000);
check('a page that is gone is dropped, and not asked for 15 minutes', !r.status.jobs[`${G}/group/app/-/jobs/31`] && r.memo.due[`jobs ${G}/group/app/-/jobs/31`] === later + 7_200_000 + CADENCE.missing);
r = await round(later + 7_200_000 + 60_000);
check('a minute on it is still not asked', !log.includes(`GET ${P}/jobs/31`));

// ---- a closed tab's page drops out ----
r = await round(later + 7_300_000, { sites: detectSites(tabs.filter(t => !t.url.includes('/43')), Infinity) });
check('the merge request of a closed tab drops out', !r.status.mrs[MR43] && r.status.mrs[MR42] && r.changed);
r = await round(later + 7_400_000, { sites: [] });
check('no connected sites: nothing is kept', Object.keys(r.status.mrs).length === 0 && Object.keys(r.status.sites).length === 0 && r.changed);
done();
