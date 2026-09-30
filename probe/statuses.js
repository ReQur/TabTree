// What the panel shows for the statuses the watch keeps (integrations.js): a row's marks and line, a branch's
// summary, the status bar's counts, the words search finds, and a details card. Pure: panel.js draws it.
//
// A mark is { state, title } for an icon (`MARKS` gives its icon and class), or { text, cls, opt } for words
// ("1/2" approvals, "ready", "~6 min"); `opt` ones hide in a narrow panel. A line is { state: 'run' | 'fail', fill }.
import { watchedOf, ACTIVE } from './integrations.js';
import { isIssuePage } from './titles.js';

// A state's icon and color class (`.i.st.<class>` in panel.css).
export const MARKS = {
  ok: ['stOk', 'ok'],
  fail: ['stFail', 'fail'],
  run: ['stRun', 'run spin'],
  pending: ['stPending', 'idle'],
  manual: ['stManual', 'idle'],
  scheduled: ['stScheduled', 'idle'],
  warn: ['stWarn', 'warn'],
  canceled: ['stCanceled', 'idle'],
  skipped: ['stSkipped', 'idle'],
  notBuilt: ['stNotBuilt', 'idle'],
  merged: ['stMerged', 'merged'],
  closed: ['stCanceled', 'idle'],
  rebase: ['stRebase', 'warn'],
  conflict: ['stConflict', 'fail'],
  discussions: ['stDiscussions', 'warn'],
  approved: ['stApproved', 'ok'],
  approvals: ['stApprovals', 'idle'],
  todo: ['stTodo', 'idle'],
  prog: ['stProg', 'run'],
  unknown: ['stUnknown', 'unk'],
  signedOut: ['stSignedOut', 'warn'],
  offline: ['stOffline', 'fail'],
};

const MINUTE = 60_000;
const minutes = ms => Math.max(1, Math.round(ms / MINUTE));

// "12 s", "6 min", "3 h", "2 days": a length of time, short.
export function span(ms) {
  if (ms < MINUTE) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (ms < 60 * MINUTE) return `${minutes(ms)} min`;
  if (ms < 48 * 60 * MINUTE) return `${Math.round(ms / (60 * MINUTE))} h`;
  return `${Math.round(ms / (24 * 60 * MINUTE))} days`;
}
export const ago = (t, now) => (t ? `${span(now - t)} ago` : '');

const PIPELINE_WORDS = { success: 'passed', failed: 'failed', running: 'running', canceled: 'canceled', skipped: 'skipped', manual: 'manual', scheduled: 'scheduled' };

// A GitLab pipeline's or job's state as a mark.
function gitlabState(status, { warnings = false, allowFailure = false } = {}) {
  if (status === 'running') return 'run';
  if (ACTIVE.has(status)) return 'pending';
  if (status === 'success') return warnings ? 'warn' : 'ok';
  if (status === 'failed') return allowFailure ? 'warn' : 'fail';
  return { canceled: 'canceled', skipped: 'skipped', manual: 'manual', scheduled: 'scheduled' }[status] ?? 'pending';
}

const JENKINS_STATES = { SUCCESS: 'ok', FAILURE: 'fail', UNSTABLE: 'warn', ABORTED: 'canceled', NOT_BUILT: 'notBuilt' };
const buildState = b => (b.building ? 'run' : JENKINS_STATES[b.result] ?? 'pending');
const BUILD_WORDS = { ok: 'passed', fail: 'failed', warn: 'unstable', canceled: 'aborted', notBuilt: 'not built', run: 'building', pending: 'pending' };

// How far a running pipeline is: its jobs over, of those that will run by themselves.
export function pipelineFill(p) {
  const j = p?.jobs;
  if (!j?.total) return 0;
  const over = j.success + j.failed + j.canceled + j.skipped + j.warnings;
  return Math.min(1, over / Math.max(1, j.total - j.manual));
}

const buildFill = (b, now) => (b.estimate && b.startedAt ? Math.min(0.99, Math.max(0, (now - b.startedAt) / b.estimate)) : 0);

function pipelineTitle(p) {
  const state = gitlabState(p.status, p);
  if (state === 'fail') return `Pipeline failed${p.failed.length ? `: ${p.failed.join(', ')}` : ''}`;
  if (state === 'warn') return 'Pipeline passed with warnings';
  if (state === 'run') {
    const j = p.jobs;
    return `Pipeline running${j?.total ? `: ${j.total - j.running - j.pending - j.manual} of ${j.total} jobs done` : ''}`;
  }
  return `Pipeline ${PIPELINE_WORDS[p.status] ?? p.status}`;
}

function pipelineBar(p) {
  if (p?.status === 'failed') return { state: 'fail', fill: 1 };
  if (p?.status === 'running') return { state: 'run', fill: pipelineFill(p) };
  return null;
}

const CONFLICT = { state: 'conflict', title: 'Has conflicts' };
const REBASE = { state: 'rebase', title: 'Needs a rebase' };
const THREADS = { state: 'discussions', title: 'Unresolved threads' };

export const isReady = m => m.state === 'opened' && m.merge === 'mergeable' && m.approved !== false && (!m.pipeline || m.pipeline.status === 'success');

// A merge request: one mark by precedence (merged, closed, pipeline failed, conflict, pipeline running or pending,
// rebase, threads, approvals missing, ready), a smaller one for a blocker beside it, and the approvals.
function mrView(m) {
  if (m.state === 'merged') return { marks: [{ state: 'merged', title: 'Merged' }], fin: true };
  if (m.state !== 'opened') return { marks: [{ state: 'closed', title: 'Closed' }], fin: true };
  const p = m.pipeline;
  const pipe = p ? { state: gitlabState(p.status, p), title: pipelineTitle(p) } : null;
  const conflict = m.merge === 'conflict' || m.conflicts;
  const rebase = m.merge === 'need_rebase';
  const threads = m.merge === 'discussions_not_resolved' || m.threadsResolved === false;
  const blocker = conflict ? CONFLICT : rebase ? REBASE : threads ? THREADS : null;
  const needed = (m.approvedBy ?? 0) + (m.approvalsLeft ?? 0);
  const approvals = m.approved === false && m.approvalsLeft > 0
    ? { text: `${m.approvedBy ?? 0}/${needed}`, icon: 'stApprovals', title: `Approvals: ${m.approvedBy ?? 0} of ${needed}` }
    : null;
  let marks;
  if (pipe?.state === 'fail') marks = [blocker, pipe];
  else if (conflict) marks = [CONFLICT];
  else if (pipe?.state === 'run' || pipe?.state === 'pending') marks = [approvals && { ...approvals, opt: true }, blocker, pipe];
  else if (blocker) marks = [approvals && { ...approvals, opt: true }, blocker];
  else if (approvals) marks = [approvals];
  else if (isReady(m)) marks = [{ text: 'ready', cls: 'ready', opt: true, title: 'Ready to merge' }, { state: 'ok', title: 'Ready to merge' }];
  else marks = [pipe];
  return { marks: marks.filter(Boolean), bar: pipelineBar(p) };
}

function pipelineView(p) {
  return { marks: [{ state: gitlabState(p.status, p), title: pipelineTitle(p) }], bar: pipelineBar(p) };
}

function jobView(j) {
  const state = gitlabState(j.status, j);
  return {
    marks: [{ state, title: `Job ${j.name}: ${PIPELINE_WORDS[j.status] ?? j.status}` }],
    bar: state === 'fail' ? { state: 'fail', fill: 1 } : null,
  };
}

function buildView(b, now) {
  const state = buildState(b);
  if (state !== 'run') return { marks: [{ state, title: `Build #${b.number}: ${BUILD_WORDS[state]}` }] };
  const left = b.estimate && b.startedAt ? b.startedAt + b.estimate - now : 0;
  return {
    marks: [left > 0 && { text: `~${minutes(left)} min`, opt: true, title: 'Time left, by Jenkins’ estimate' }, { state, title: `Build #${b.number} building` }].filter(Boolean),
    bar: { state: 'run', fill: buildFill(b, now) },
  };
}

const LOZENGE = { new: 'todo', indeterminate: 'prog', done: 'done' };

function ticketView(t) {
  const cls = LOZENGE[t.category] ?? 'prog';
  return { lozenge: { cls, name: t.name, state: cls === 'done' ? 'ok' : cls }, me: !!t.assignee?.me, fin: cls === 'done' };
}

// The site a status came from: the Jira site for tickets, else the site whose address starts the page's.
export function siteOf(map, id, status) {
  const sites = Object.entries(status?.sites ?? {});
  const [base, site] = map === 'tickets'
    ? sites.find(([, s]) => s.kind === 'jira') ?? []
    : sites.filter(([b]) => id.startsWith(`${b}/`)).sort((a, b) => b[0].length - a[0].length)[0] ?? [];
  return base ? { base, ...site } : null;
}

// What a status turned into, for the "changed while you were away" dot: bad news, good news, or news.
const newsOf = view => {
  const states = view.marks?.map(m => m.state) ?? [];
  if (states.includes('fail') || states.includes('conflict')) return 'fail';
  if (states.some(s => ['ok', 'merged'].includes(s)) || view.lozenge?.cls === 'done') return 'ok';
  return 'news';
};

// A tab row's status. `ticketRoot`: the row is its ticket's root, where the ticket's status shows. `watched(map,
// tab)` says whether the watch asks the site of such a page (connected, and the watch on).
export function rowStatus(tab, { status, ticketRoot = false, watched = () => false, now = Date.now() }) {
  const found = watchedOf(tab);
  const own = found.find(([map]) => map !== 'tickets');
  const ticket = ticketRoot ? found.find(([map]) => map === 'tickets') : null;
  const [map, id] = own ?? ticket ?? [];
  if (!map) return null;
  const data = status?.[map]?.[id];
  if (!data) return watched(map, tab) ? { marks: [{ state: 'unknown', title: 'Checking…' }], unknown: true, item: [map, id] } : null;
  const view = map === 'mrs' ? mrView(data)
    : map === 'pipelines' ? pipelineView(data)
      : map === 'jobs' ? jobView(data)
        : map === 'tickets' ? ticketView(data)
          : buildView(data, now);
  const site = siteOf(map, id, status);
  const away = data.t > (data.t0 ?? data.t) && data.t > (tab.lastAccessed ?? 0) && !tab.active;
  return { ...view, item: [map, id], stale: site ? !site.ok : false, changed: away ? newsOf(view) : null };
}

// Failed and running pages in a branch, for a folder or a folded row: [{ state, count }], worst first.
export function summaryOf(tabs, status, now = Date.now()) {
  let fail = 0;
  let run = 0;
  let stale = false;
  for (const tab of tabs) {
    const view = rowStatus(tab, { status, now });
    if (!view?.marks) continue;
    const states = view.marks.map(m => m.state);
    if (states.includes('fail')) fail++;
    else if (states.includes('run')) run++;
    else continue;
    stale ||= view.stale;
  }
  return { parts: [fail && { state: 'fail', count: fail }, run && { state: 'run', count: run }].filter(Boolean), stale };
}

// Tabs whose work is over: merged or closed merge requests, and Jira pages of tickets that are done.
export function isFinished(tab, status) {
  const [own] = watchedOf(tab);
  if (!own) return false;
  const [map, id] = own;
  if (map === 'mrs') return ['merged', 'closed', 'locked'].includes(status?.mrs?.[id]?.state);
  return map === 'tickets' && status?.tickets?.[id]?.category === 'done' && isIssuePage(tab, id);
}

// The status bar's counts over the workspace's tabs, and the sites in trouble.
export function barOf(tabs, status, now = Date.now()) {
  let fail = 0;
  let run = 0;
  const finished = [];
  for (const tab of tabs) {
    const view = rowStatus(tab, { status, now });
    const states = view?.marks?.map(m => m.state) ?? [];
    if (states.includes('fail')) fail++;
    else if (states.includes('run')) run++;
    if (isFinished(tab, status)) finished.push(tab.id);
  }
  const trouble = Object.entries(status?.sites ?? {}).filter(([, s]) => !s.ok).map(([base, s]) => ({ base, ...s }));
  return { fail, run, finished, trouble };
}

// The words search finds a tab by: failed, running, merged, ready, done, rebase…
export function statusWords(tab, status) {
  const words = [];
  for (const [map, id] of watchedOf(tab)) {
    const d = status?.[map]?.[id];
    if (!d) continue;
    if (map === 'tickets') words.push(d.name, { new: 'to do', indeterminate: 'in progress', done: 'done' }[d.category]);
    if (map === 'mrs') {
      words.push(d.state === 'opened' ? (d.draft ? 'draft' : 'open') : d.state);
      if (d.pipeline) words.push(PIPELINE_WORDS[d.pipeline.status] ?? d.pipeline.status);
      if (isReady(d)) words.push('ready');
      if (d.merge === 'need_rebase') words.push('rebase');
      if (d.merge === 'conflict' || d.conflicts) words.push('conflict');
      if (d.approved) words.push('approved');
    }
    if (map === 'pipelines' || map === 'jobs') words.push(PIPELINE_WORDS[d.status] ?? d.status);
    if (map === 'builds' || map === 'projects') words.push(BUILD_WORDS[buildState(d)], d.building ? 'running' : '');
  }
  return words.filter(Boolean).join(' ').toLowerCase();
}

// ---- the details card ----
// A card is { state, key, title, badges, meta, lozenge, banner, stale, sections, footer }. A section is { label,
// meter, lines, flush } (`flush`: no rule above it); a line is { state | icon, text, right, sub, strong, tone }, where
// `icon` is a plain icon drawn muted (`me` is the person dot).

function stageRight(s) {
  if (s.status === 'skipped') return 'skipped';
  if (s.status === 'pending' && !s.done) return 'waiting';
  if (s.status === 'manual') return 'manual';
  const extra = s.failed.length ? ` · ${s.failed.length} failed` : s.running.length ? ` · ${s.running.length} running` : '';
  return `${s.done}/${s.total}${extra}`;
}

function pipelineSection(p, now) {
  const state = gitlabState(p.status, p);
  const label = state === 'run' ? `running for ${span(now - (p.startedAt ?? now))}`
    : p.duration && ['fail', 'ok', 'warn', 'canceled'].includes(state) ? `${state === 'fail' ? 'failed after' : state === 'canceled' ? 'canceled after' : 'passed in'} ${span(p.duration * 1000)}`
      : PIPELINE_WORDS[p.status] ?? p.status;
  const lines = [];
  for (const s of p.stages ?? []) {
    lines.push({ state: gitlabState(s.status), text: s.name, right: stageRight(s) });
    for (const name of s.failed) lines.push({ state: 'fail', text: name, sub: true });
    for (const r of s.running) lines.push({ text: r.name, right: r.startedAt ? span(now - r.startedAt) : '', sub: true });
  }
  return { label: `Pipeline #${p.id} · ${label}`, meter: state === 'run' ? pipelineFill(p) : null, lines };
}

function mergeSection(m) {
  const lines = [];
  if (m.merge === 'conflict' || m.conflicts) lines.push({ state: 'conflict', text: 'Has conflicts' });
  if (m.merge === 'need_rebase') lines.push({ state: 'rebase', text: 'Needs a rebase' });
  if (m.merge === 'discussions_not_resolved' || m.threadsResolved === false) lines.push({ state: 'discussions', text: 'Unresolved threads' });
  if (m.merge === 'ci_still_running') lines.push({ state: 'run', text: 'Waits for the pipeline' });
  if (m.merge === 'ci_must_pass') lines.push({ state: 'fail', text: 'The pipeline has to pass' });
  if (m.merge === 'blocked_status') lines.push({ state: 'warn', text: 'Blocked by another merge request' });
  // With no approvals asked for, and none given, there is nothing to say about them.
  const needed = (m.approvedBy ?? 0) + (m.approvalsLeft ?? 0);
  if (m.approved != null && needed > 0) {
    lines.push(m.approved
      ? { state: 'approved', text: 'Approved', right: `${m.approvedBy} of ${needed}` }
      : { state: 'approvals', text: 'Approvals', right: `${m.approvedBy ?? 0} of ${needed}` });
  }
  if (isReady(m)) lines.push({ state: 'ok', text: 'Ready to merge', strong: true, tone: 'ok' });
  return { label: 'Merge', lines };
}

const BANNERS = {
  'signed out': (host, from) => `Signed out of ${host}. This is the last known status${from ? `, from ${from}` : ''}.`,
  offline: (host, from) => `Can't reach ${host}: no network, or the VPN is off. This is the last known status${from ? `, from ${from}` : ''}.`,
};

// The card for a tab row's status. `tab`, the row's `title` (cleaned) and `key`; `branch`: the tabs under the row
// (for a ticket's open merge requests); `checked(base)`: when the site was last asked; `clock(t)`: a time of day.
export function cardOf(tab, { status, title, key, branch = [], checked = () => null, clock = t => String(t), now = Date.now(), ticketRoot = false }) {
  const view = rowStatus(tab, { status, ticketRoot, now });
  if (!view?.item) return null;
  const [map, id] = view.item;
  const d = status[map][id];
  const site = siteOf(map, id, status);
  const host = site ? new URL(site.base).host : '';
  const at = site && checked(site.base);
  const card = { state: view.marks?.at(-1)?.state ?? view.lozenge?.state, badges: [], sections: [] };
  const away = view.changed ? `, while you were away` : '';
  if (map === 'mrs') {
    const number = id.match(/(\d+)$/)[1];
    const p = d.pipeline;
    card.title = `!${number} ${title}`;
    if (d.draft) card.badges.push('draft');
    const state = d.state === 'opened' ? 'open' : d.state;
    const failedAt = p?.status === 'failed' && p.finishedAt ? ` · failed ${ago(p.finishedAt, now)}${away}` : '';
    card.meta = [key, state].filter(Boolean).join(' · ') + failedAt;
    if (p) card.sections.push(pipelineSection(p, now));
    if (d.state === 'opened') card.sections.push(mergeSection(d));
    card.footer = { text: [host, at && `checked ${ago(at, now)}`].filter(Boolean).join(' · '), button: p ? { label: 'Open pipeline', url: `${id.replace(/\/-\/merge_requests\/\d+$/, '')}/-/pipelines/${p.id}` } : { label: 'Open MR', tab: true } };
  } else if (map === 'pipelines') {
    card.title = `Pipeline #${d.id}`;
    card.meta = id.replace(/^https?:\/\/[^/]+\//, '').replace(/\/-\/pipelines\/\d+$/, '');
    card.sections.push(pipelineSection(d, now));
    card.footer = { text: [host, at && `checked ${ago(at, now)}`].filter(Boolean).join(' · '), button: { label: 'Open pipeline', tab: true } };
  } else if (map === 'jobs') {
    const state = gitlabState(d.status, d);
    card.title = `${d.name} #${id.match(/(\d+)$/)[1]}`;
    card.meta = [`stage ${d.stage}`, d.pipelineId && `pipeline #${d.pipelineId}`].filter(Boolean).join(' · ');
    const how = state === 'run' ? `Running for ${span(now - (d.startedAt ?? now))}`
      : state === 'fail' ? `Failed after ${span((d.duration ?? 0) * 1000)}`
        : state === 'ok' ? `Passed in ${span((d.duration ?? 0) * 1000)}`
          : `${(PIPELINE_WORDS[d.status] ?? d.status).replace(/^./, c => c.toUpperCase())}`;
    const tone = ['fail', 'ok'].includes(state) ? state : null;
    card.sections.push({ lines: [{ state, text: how, right: d.finishedAt ? ago(d.finishedAt, now) : '', strong: !!tone, tone }] });
    card.footer = { text: [host, at && `checked ${ago(at, now)}`].filter(Boolean).join(' · '), button: { label: 'Open job', tab: true } };
  } else if (map === 'tickets') {
    card.title = title;
    card.key = id;
    card.lozenge = { ...view.lozenge, note: d.since ? `for ${span(now - d.since)}` : '' };
    const lines = [
      d.assignee?.me ? { icon: 'me', text: 'Assigned to you' } : { icon: 'stApprovals', text: d.assignee ? `Assigned to ${d.assignee.name}` : 'Unassigned' },
      d.since && { icon: 'stClock', text: `Status changed ${ago(d.since, now)}` },
    ];
    const open = branch.filter(t => watchedOf(t).some(([m, i]) => m === 'mrs' && status.mrs?.[i]?.state === 'opened')).length;
    if (open) lines.push({ icon: 'mr', text: 'Open merge requests under it', right: String(open) });
    card.sections.push({ lines: lines.filter(Boolean) });
    card.footer = { text: [host, at && `checked ${ago(at, now)}`].filter(Boolean).join(' · ') };
  } else {
    const state = buildState(d);
    card.title = `${d.job ?? 'Build'} #${d.number}`;
    card.meta = state === 'run' ? `building · started ${ago(d.startedAt, now)}`
      : [BUILD_WORDS[state], d.duration && span(d.duration), d.startedAt && ago(d.startedAt, now)].filter(Boolean).join(' · ');
    const lines = [];
    if (state === 'run' && d.estimate) {
      const left = d.startedAt + d.estimate - now;
      lines.push({ text: left > 0 ? `About ${span(left)} left` : 'Longer than usual', right: `estimate ${span(d.estimate)}` });
    }
    card.sections.push({ meter: state === 'run' ? buildFill(d, now) : null, lines, flush: true });
    if (d.recent?.length) {
      card.sections.push({
        label: 'Last builds',
        lines: d.recent.map(b => {
          const s = JENKINS_STATES[b.result] ?? 'pending';
          return { state: s, text: `#${b.number} ${BUILD_WORDS[s]}`, right: [b.startedAt && ago(b.startedAt, now), b.duration && span(b.duration)].filter(Boolean).join(' · ') };
        }),
      });
    }
    card.footer = { text: [host, at && `checked ${ago(at, now)}`].filter(Boolean).join(' · ') };
  }
  if (view.stale && site) {
    card.banner = { text: BANNERS[site.error]?.(host, at && clock(at)) ?? `${host} doesn't answer.`, action: site.error === 'offline' ? 'Retry' : 'Sign in', base: site.base };
    card.stale = true;
  }
  return card;
}
