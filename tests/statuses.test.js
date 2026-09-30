// What the panel shows for a status (probe/statuses.js): the marks of a merge request by precedence, pipelines,
// jobs, builds and tickets, the line, unknown, stale and changed, summaries, the status bar, search words.
import { check, done } from './helpers/check.js';
import { rowStatus, summaryOf, barOf, statusWords, span, cardOf } from '../probe/statuses.js';

const G = 'https://gitlab.example.com';
const NOW = Date.parse('2026-09-30T12:00:00Z');
const mrTab = { id: 1, url: `${G}/group/app/-/merge_requests/42`, title: 'PROJ-1: Thing (!42) · Merge requests · group / app · GitLab', lastAccessed: NOW };
const pipe = (status, over = {}) => ({ id: 5, status, warnings: false, stages: [], jobs: { total: 4, success: 2, failed: 0, running: 1, pending: 1, skipped: 0, manual: 0, canceled: 0, warnings: 0 }, failed: [], running: [], ...over });
const mr = over => ({ state: 'opened', draft: false, merge: 'mergeable', conflicts: false, threadsResolved: true, approved: true, approvalsLeft: 0, approvedBy: 1, pipeline: pipe('success'), t0: 1, t: 1, ...over });
const status = (data, site = { kind: 'gitlab', ok: true }) => ({ sites: { [G]: site }, mrs: { [mrTab.url]: data } });
const marks = (data, tab = mrTab) => {
  const v = rowStatus(tab, { status: status(data), now: NOW });
  return (v?.marks ?? []).map(m => m.state ?? `"${m.text}"`).join(' ') + (v?.bar ? ` / ${v.bar.state} ${Math.round(v.bar.fill * 100)}%` : '');
};

const precedence = [
  ['merged', mr({ state: 'merged', merge: 'conflict' }), 'merged'],
  ['closed', mr({ state: 'closed' }), 'closed'],
  ['pipeline failed, with a rebase beside it', mr({ merge: 'need_rebase', pipeline: pipe('failed') }), 'rebase fail / fail 100%'],
  ['conflict', mr({ merge: 'conflict', pipeline: pipe('running') }), 'conflict / run 50%'],
  ['running, approvals missing, threads', mr({ merge: 'discussions_not_resolved', approved: false, approvalsLeft: 1, pipeline: pipe('running') }), '"1/2" discussions run / run 50%'],
  ['pending', mr({ pipeline: pipe('pending') }), 'pending'],
  ['needs a rebase', mr({ merge: 'need_rebase' }), 'rebase'],
  ['approvals missing', mr({ merge: 'not_approved', approved: false, approvalsLeft: 2, approvedBy: 0 }), '"0/2"'],
  ['ready', mr({}), '"ready" ok'],
  ['passed but not ready (a draft)', mr({ draft: true, merge: 'draft_status' }), 'ok'],
  ['passed with warnings, not ready', mr({ merge: 'checking', pipeline: pipe('success', { warnings: true }) }), 'warn'],
  ['no pipeline, nothing in the way', mr({ merge: 'checking', pipeline: null }), ''],
];
for (const [what, data, expected] of precedence) check(`merge request, ${what}: ${marks(data)}`, marks(data) === expected);
check('merged and closed are finished', rowStatus(mrTab, { status: status(mr({ state: 'merged' })) }).fin && !rowStatus(mrTab, { status: status(mr({})) }).fin);

const pipeTab = { id: 2, url: `${G}/group/app/-/pipelines/7`, title: 'Pipeline · group / app · GitLab' };
const pipeline = data => {
  const v = rowStatus(pipeTab, { status: { sites: { [G]: { kind: 'gitlab', ok: true } }, pipelines: { [pipeTab.url]: data } }, now: NOW });
  return v.marks.map(m => m.state).join() + (v.bar ? ` / ${v.bar.state}` : '');
};
check('pipelines: created and pending wait, manual, scheduled, canceled, skipped',
  ['created', 'waiting_for_resource', 'pending', 'manual', 'scheduled', 'canceled', 'skipped'].map(s => pipeline(pipe(s))).join() === 'pending,pending,pending,manual,scheduled,canceled,skipped');
check('a running pipeline has its line; a failed one a full red line; a passed one none',
  pipeline(pipe('running')) === 'run / run' && pipeline(pipe('failed')) === 'fail / fail' && pipeline(pipe('success')) === 'ok');

const jobTab = { id: 3, url: `${G}/group/app/-/jobs/31`, title: 'rpm-tests (#31) · Jobs · group / app · GitLab' };
const job = data => rowStatus(jobTab, { status: { sites: { [G]: { kind: 'gitlab', ok: true } }, jobs: { [jobTab.url]: data } } });
check('a job allowed to fail is a warning, a failed one has its red line',
  job({ status: 'failed', allowFailure: true, name: 'lint' }).marks[0].state === 'warn' && job({ status: 'failed', name: 'rpm' }).bar.state === 'fail' && !job({ status: 'running', name: 'rpm' }).bar);

const J = 'https://ci.example.com/job/nightly/128/';
const buildTab = { id: 4, url: J, title: 'nightly #128 [Jenkins]' };
const build = data => rowStatus(buildTab, { status: { sites: {}, builds: { [J]: data } }, now: NOW });
const building = build({ number: 128, building: true, result: null, startedAt: NOW - 240_000, estimate: 600_000 });
check(`a building build: time left and a line by the estimate: ${building.marks.map(m => m.text ?? m.state)} ${building.bar.fill}`,
  building.marks.map(m => m.text ?? m.state).join() === '~6 min,run' && building.bar.fill === 0.4);
check('its results', ['SUCCESS', 'FAILURE', 'UNSTABLE', 'ABORTED', 'NOT_BUILT'].map(result => build({ number: 1, building: false, result }).marks[0].state).join() === 'ok,fail,warn,canceled,notBuilt');

const jiraTab = { id: 5, url: 'https://jira.example.com/browse/PROJ-1', title: '[PROJ-1] Thing - Jira' };
const ticket = (data, opts = {}) => rowStatus(jiraTab, { status: { sites: { 'https://jira.example.com': { kind: 'jira', ok: true } }, tickets: data ? { 'PROJ-1': data } : {} }, ticketRoot: true, ...opts });
check('a ticket: a lozenge by its category, the dot when it is on you, done is finished',
  ticket({ name: 'Validation', category: 'indeterminate', assignee: { me: true } }).lozenge.cls === 'prog' && ticket({ name: 'Validation', category: 'indeterminate', assignee: { me: true } }).me
  && ticket({ name: 'Open', category: 'new' }).lozenge.cls === 'todo' && ticket({ name: 'Done', category: 'done' }).fin);
check('a ticket only on its root row', !rowStatus(jiraTab, { status: { tickets: { 'PROJ-1': { name: 'Open', category: 'new' } } } }));
check('not known yet, from a watched site: "checking"', ticket(null, { watched: () => true }).marks[0].state === 'unknown' && !ticket(null));

check('a site in trouble: its statuses are stale', rowStatus(mrTab, { status: status(mr({}), { kind: 'gitlab', ok: false, error: 'signed out' }) }).stale);
const changed = over => rowStatus({ ...mrTab, lastAccessed: 50, ...over }, { status: status(mr({ pipeline: pipe('failed'), t0: 10, t: 100 })) }).changed;
check('changed after the tab was last looked at: bad news; not when looked at since, or when it is in view',
  changed({}) === 'fail' && changed({ lastAccessed: 200 }) === null && changed({ active: true }) === null);
check('a status first seen is not a change', rowStatus({ ...mrTab, lastAccessed: 0 }, { status: status(mr({ t0: 100, t: 100 })) }).changed === null);

const tabs = [mrTab, pipeTab, jobTab, jiraTab, { id: 6, url: `${G}/group/app/-/merge_requests/9`, title: 'x' }];
const all = {
  sites: { [G]: { kind: 'gitlab', ok: true }, 'https://jira.example.com': { kind: 'jira', ok: false, error: 'offline' } },
  mrs: { [mrTab.url]: mr({ pipeline: pipe('running') }), [`${G}/group/app/-/merge_requests/9`]: mr({ state: 'merged' }) },
  pipelines: { [pipeTab.url]: pipe('failed') },
  jobs: { [jobTab.url]: { status: 'failed', name: 'rpm' } },
  tickets: { 'PROJ-1': { name: 'Done', category: 'done' } },
};
check(`a branch's summary: failed first, then running: ${JSON.stringify(summaryOf(tabs, all).parts)}`, JSON.stringify(summaryOf(tabs, all).parts) === '[{"state":"fail","count":2},{"state":"run","count":1}]');
const sb = barOf(tabs, all);
check(`the status bar: ${sb.fail} failed, ${sb.run} running, finished ${sb.finished}, trouble ${sb.trouble.map(t => t.error)}`,
  sb.fail === 2 && sb.run === 1 && sb.finished.join() === '5,6' && sb.trouble.map(t => t.error).join() === 'offline');
check(`search words: ${statusWords(mrTab, status(mr({ merge: 'need_rebase', pipeline: pipe('failed') })))}`, statusWords(mrTab, status(mr({ merge: 'need_rebase', pipeline: pipe('failed') }))) === 'open failed rebase approved');
const approvalLines = data => cardOf(mrTab, { status: status(data), title: 'Thing', now: NOW }).sections.at(-1).lines.map(l => `${l.text}${l.right ? ` ${l.right}` : ''}`).join('|');
check(`no approvals asked for and none given: nothing about them: ${approvalLines(mr({ merge: 'need_rebase', approved: false, approvalsLeft: 0, approvedBy: 0 }))}`,
  approvalLines(mr({ merge: 'need_rebase', approved: false, approvalsLeft: 0, approvedBy: 0 })) === 'Needs a rebase'
  && approvalLines(mr({ approved: true, approvalsLeft: 0, approvedBy: 2 })) === 'Approved 2 of 2|Ready to merge');
check(`times: ${[12_000, 360_000, 3 * 3_600_000, 3 * 86_400_000].map(span)}`, [12_000, 360_000, 3 * 3_600_000, 3 * 86_400_000].map(span).join() === '12 s,6 min,3 h,3 days');
done();
