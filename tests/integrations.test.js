// The statuses probe (probe/integrations.js): which Jira, GitLab and Jenkins sites are behind the tabs, what
// is asked of them, and how each kind of answer reads.
import { check, done } from './helpers/check.js';
import { detectSites, probeSite, originPattern } from '../probe/integrations.js';

const tab = (title, url) => ({ title, url });
const json = (status, body) => ({ type: 'basic', status, headers: { get: () => 'application/json; charset=utf-8' }, json: async () => body });
const page = status => ({ type: 'basic', status, headers: { get: () => 'text/html; charset=utf-8' }, json: async () => ({}) });
const redirect = () => ({ type: 'opaqueredirect', status: 0, headers: { get: () => null } });
// A fake network: answers by path, records what was asked.
const asked = [];
const network = routes => async (url, init) => {
  asked.push({ url, init });
  const answer = routes[new URL(url).pathname];
  return answer ? answer(init) : json(404, { message: '404 Not Found' });
};
const lines = results => results.map(r => `${r.ok ? '✓' : '✗'} ${r.name}: ${r.text}`);

const sites = detectSites([
  tab('[PROJ-1] Rate limiter - Jira', 'https://jira.example.com/browse/PROJ-1'),
  tab('PROJ board - Jira', 'https://jira.example.com/jira/software/projects/PROJ/boards/1?selectedIssue=PROJ-9'),
  tab('[PROJ-2] Ledger - Jira', 'https://jira.example.com/browse/PROJ-2'),
  tab('PROJ-1: Rate limiter (!42) · Merge requests · group / sub / app · GitLab', 'https://gitlab.example.com/group/sub/app/-/merge_requests/42/diffs'),
  tab('Pipeline · group / app · GitLab', 'https://gitlab.example.com/group/app/-/pipelines/900'),
  tab('build (#31) · Jobs · group / app · GitLab', 'https://gitlab.example.com/group/app/-/jobs/31'),
  tab('Merge requests · GitLab', 'https://gitlab.example.com/dashboard/merge_requests'),
  tab('nightly #128 Console [Jenkins]', 'https://ci.example.com/jenkins/job/infra/job/nightly/128/console'),
  tab('Backend engineer', 'https://careers.example.com/job/engineer/12345/'),
  tab('Latency - Dashboards - Grafana', 'https://grafana.example.com/d/lat'),
  tab('Speed Dial', 'opera://startpage'),
]);
const by = kind => sites.find(s => s.kind === kind);
check(`one site of each kind, nothing else: ${sites.map(s => `${s.kind} ${s.base}`).join(', ')}`, sites.length === 3);
check(`Jira, with the keys of its issue pages: ${by('jira').keys}`, by('jira').base === 'https://jira.example.com' && by('jira').keys.join() === 'PROJ-1,PROJ-2');
const gl = by('gitlab');
check('GitLab, with a merge request, a pipeline and a job of their projects',
  gl.mrs[0]?.path === 'group/sub/app' && gl.mrs[0].id === '42' && gl.pipelines[0]?.id === '900' && gl.jobs[0]?.path === 'group/app');
check(`Jenkins, under its path, with the build: ${by('jenkins').builds}`,
  by('jenkins').base === 'https://ci.example.com/jenkins' && by('jenkins').builds.join() === 'https://ci.example.com/jenkins/job/infra/job/nightly/128/');
check('access is asked for the whole origin', originPattern(by('jenkins')) === 'https://ci.example.com/*');
const [cloud] = detectSites([
  tab('Board - Jira', 'https://acme.atlassian.net/jira/software/projects/PROJ/boards/1'),
  tab('PROJ-7: Fix (!3) · Merge requests · g / a · GitLab', 'https://gitlab.example.com/g/a/-/merge_requests/3'),
]);
check(`no issue page open: the keys of other tabs stand in: ${cloud.keys}`, cloud.kind === 'jira' && cloud.keys.join() === 'PROJ-7');
const named = detectSites([
  tab('app · Our code', 'https://gitlab.corp.example.com/group/app'),
  tab('System dashboard', 'https://jira.corp.example.com/secure/Dashboard.jspa'),
  tab('Dashboard', 'https://jenkins.example.com/'),
  tab('Mirror', 'https://mygitlabmirror.example.com/group/app'),
]);
check(`a host named after its tool says it on any page: ${named.map(s => `${s.kind} ${s.base}`)}`,
  named.map(s => `${s.kind} ${s.base}`).join() === 'gitlab https://gitlab.corp.example.com,jira https://jira.corp.example.com,jenkins https://jenkins.example.com');

const jira = await probeSite(by('jira'), {
  fetch: network({
    '/rest/api/3/myself': () => json(200, { accountId: 'a1' }),
    '/rest/api/3/issue/PROJ-1': () => json(200, { fields: { status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } } }),
    '/rest/api/3/search/jql': () => json(200, { issues: [{ key: 'PROJ-1' }, { key: 'PROJ-2' }] }),
    '/rest/api/3/issue/bulkfetch': () => json(403, { errorMessages: ['XSRF check failed'] }),
  }),
});
check(`Jira:\n  ${lines(jira).join('\n  ')}`, lines(jira).join('\n') === [
  '✓ Signed in: yes',
  '✓ A ticket: In Progress · indeterminate',
  '✓ Search by JQL: 2 of 2 found',
  '✗ Bulk fetch (POST): HTTP 403 · forbidden · XSRF check failed',
].join('\n'));
check('every request goes with the session, asks for JSON and follows no redirect',
  asked.every(a => a.init.credentials === 'include' && a.init.redirect === 'manual' && a.init.headers.Accept === 'application/json'));
const search = asked.find(a => a.url.includes('/search/jql'));
check(`the search: ${search.url}`, new URL(search.url).searchParams.get('jql') === 'key in (PROJ-1, PROJ-2)' && new URL(search.url).searchParams.get('fields') === 'status');
const bulk = asked.find(a => a.url.endsWith('/bulkfetch'));
check('the bulk fetch is a POST that says it is no form submission',
  bulk.init.method === 'POST' && bulk.init.headers['X-Atlassian-Token'] === 'no-check' && JSON.parse(bulk.init.body).issueIdsOrKeys.join() === 'PROJ-1,PROJ-2');

asked.length = 0;
const gitlab = await probeSite(gl, {
  fetch: network({
    '/api/v4/user': () => json(401, { message: '401 Unauthorized' }),
    '/api/v4/projects/group%2Fsub%2Fapp/merge_requests/42': () => json(200, { state: 'opened', draft: true, detailed_merge_status: 'draft_status', head_pipeline: { status: 'running' } }),
    '/api/v4/projects/group%2Fsub%2Fapp/merge_requests/42/approvals': () => json(200, { approved: false, approved_by: [], approvals_left: 1 }),
    '/api/v4/projects/group%2Fapp/pipelines/900': () => redirect(),
    '/api/v4/projects/group%2Fapp/jobs/31': () => page(200),
  }),
});
check(`GitLab:\n  ${lines(gitlab).join('\n  ')}`, lines(gitlab).join('\n') === [
  '✗ Signed in: HTTP 401 · not signed in: the session did not come along · 401 Unauthorized',
  '✓ A merge request: opened · draft · draft_status · pipeline running',
  '✓ Its approvals: not approved · by 0 · 1 left',
  '✗ A pipeline: redirected, likely to a login page: the session did not come along',
  '✗ A job: HTTP 200 with a web page instead of JSON (a login page?)',
].join('\n'));

const jenkins = await probeSite(by('jenkins'), {
  fetch: network({
    '/jenkins/whoAmI/api/json': () => json(200, { anonymous: true, name: 'anonymous' }),
    '/jenkins/job/infra/job/nightly/128/api/json': () => {
      throw new TypeError('Failed to fetch');
    },
  }),
});
check(`Jenkins:\n  ${lines(jenkins).join('\n  ')}`, lines(jenkins).join('\n') === [
  '✗ Signed in: as anonymous: the session did not come along',
  '✗ A build: network error: Failed to fetch',
].join('\n'));

// A site that never answers: the request is given up.
const silent = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
const late = await probeSite({ ...by('jenkins'), builds: [] }, { fetch: silent, timeout: 50 });
check(`no answer: ${lines(late)}`, lines(late).join() === '✗ Signed in: no answer in 0.05 s');
const odd = await probeSite({ ...by('jenkins'), builds: [] }, { fetch: network({ '/jenkins/whoAmI/api/json': () => json(200, { hello: 1 }) }) });
check(`JSON of another shape: ${lines(odd)}`, lines(odd).join() === '✗ Signed in: an answer of another shape');
done();
