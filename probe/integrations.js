// Statuses from Jira, GitLab and Jenkins. detectSites() finds these sites behind the open tabs; probeSite()
// checks that the browser's session works for one (Settings › Statuses › Test); pollSites() is one round of the
// watch that keeps the statuses of the open tabs' tickets, merge requests, pipelines, jobs and builds. All of it
// only reads, with the browser's own session.
import { ticketKey } from './titles.js';

const SAMPLES = 5;
const JIRA_TITLE = /\s[-–—|]\s+(Jira|JIRA)$/;
const JENKINS_TITLE = /\[Jenkins\]$|\s[-–—]\s+Jenkins$/;
// GitLab's pages of a project are under "/<group>/<project>/-/".
const GITLAB_PAGE = /^\/(.+?)\/-\/(merge_requests|pipelines|jobs)\/(\d+)/;
const GITLAB_MAPS = { merge_requests: 'mrs', pipelines: 'pipelines', jobs: 'jobs' };
// A Jenkins build: an optional context path, one or more "/job/<name>", then the build number. Without the
// number, it is the Jenkins job (a project) itself.
const JENKINS_BUILD = /^(.*?)((?:\/job\/[^/]+)+)\/(\d+)(?:\/|$)/;
const JENKINS_PROJECT = /^(.*?)((?:\/job\/[^/]+)+)(?:\/|$)/;
const JENKINS_ROOT = /^(.*?)\/(?:job|view|computer|manage|user|me)(?:\/|$)/;
// A host named after its tool (gitlab.example.com) says what it is on any page, whatever the page's title.
const namedFor = (host, tool) => host.split('.').includes(tool);

// The sites behind the tabs: { kind: 'jira' | 'gitlab' | 'jenkins', origin, base, keys, mrs, pipelines, jobs,
// builds, projects }. `base` is where the API lives (Jenkins may sit under a path). The lists are the site's
// pages in the tabs, up to `limit` of each: a few for the probe, all of them for the watch.
export function detectSites(tabs, limit = SAMPLES) {
  const sites = new Map();
  const siteOf = (kind, origin, base = origin) => {
    const id = `${kind} ${base}`;
    if (!sites.has(id)) sites.set(id, { kind, origin, base, keys: [], mrs: [], pipelines: [], jobs: [], builds: [], projects: [] });
    return sites.get(id);
  };
  const add = (list, item) => {
    if (list.length < limit && !list.some(x => JSON.stringify(x) === JSON.stringify(item))) list.push(item);
  };
  const keys = [];
  for (const t of tabs) {
    let url;
    try {
      url = new URL(t.url || '');
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    const title = t.title || '';
    const key = ticketKey(t);
    if (key && !keys.includes(key)) keys.push(key);
    const gitlab = url.pathname.match(GITLAB_PAGE);
    if (gitlab) {
      const [, path, type, id] = gitlab;
      add(siteOf('gitlab', url.origin)[GITLAB_MAPS[type]], { path, id });
    } else if (/\s·\s+GitLab$/.test(title) || namedFor(url.hostname, 'gitlab')) {
      siteOf('gitlab', url.origin);
    } else if (/^\/browse\/[A-Z][A-Z0-9]+-\d+/.test(url.pathname) || url.hostname.endsWith('.atlassian.net') || JIRA_TITLE.test(title) || namedFor(url.hostname, 'jira')) {
      const site = siteOf('jira', url.origin);
      if (key) add(site.keys, key);
    } else if (JENKINS_TITLE.test(title) || namedFor(url.hostname, 'jenkins')) {
      // "/job/<name>/<number>/" alone could be any site's: the title or the host has to say Jenkins.
      const build = url.pathname.match(JENKINS_BUILD);
      const jenkinsJob = build ? null : url.pathname.match(JENKINS_PROJECT);
      const root = (build ?? jenkinsJob)?.[1] ?? url.pathname.match(JENKINS_ROOT)?.[1] ?? url.pathname.replace(/\/+$/, '');
      const site = siteOf('jenkins', url.origin, url.origin + root);
      if (build) add(site.builds, `${url.origin}${build[1]}${build[2]}/${build[3]}/`);
      else if (jenkinsJob) add(site.projects, `${url.origin}${jenkinsJob[1]}${jenkinsJob[2]}/`);
    }
  }
  // A ticket's key may be in any tab (a merge request's title): after its own pages' keys, the first Jira site
  // takes the keys that no other Jira site has.
  const [jira, ...otherJira] = [...sites.values()].filter(s => s.kind === 'jira');
  for (const key of keys) {
    if (jira && !otherJira.some(s => s.keys.includes(key))) add(jira.keys, key);
  }
  return [...sites.values()];
}

// ---- the probe ----

// What to ask a site. `read` turns a JSON answer into a short text, or gives { fail } or nothing when the answer
// isn't the expected one.
function checksFor(site) {
  if (site.kind === 'jira') {
    const api = path => `${site.base}/rest/api/3${path}`;
    const keys = site.keys;
    const found = j => Array.isArray(j.issues) && `${j.issues.length} of ${keys.length} found`;
    return [
      { name: 'Signed in', url: api('/myself'), read: j => j.accountId && 'yes' },
      keys.length && {
        name: 'A ticket',
        url: api(`/issue/${keys[0]}?fields=status`),
        read: j => j.fields?.status && `${j.fields.status.name} · ${j.fields.status.statusCategory?.key ?? '?'}`,
      },
      keys.length && {
        name: 'Search by JQL',
        url: api(`/search/jql?${new URLSearchParams({ jql: `key in (${keys.join(', ')})`, fields: 'status', maxResults: '50' })}`),
        read: found,
      },
      keys.length && { name: 'Bulk fetch (POST)', url: api('/issue/bulkfetch'), init: bulkFetch(keys, ['status']), read: found },
    ].filter(Boolean);
  }
  if (site.kind === 'gitlab') {
    const api = path => `${site.base}/api/v4${path}`;
    const [mr] = site.mrs;
    const [pipeline] = site.pipelines;
    const [job] = site.jobs;
    return [
      { name: 'Signed in', url: api('/user'), read: j => j.id != null && 'yes' },
      mr && {
        name: 'A merge request',
        url: api(`${project(mr.path)}/merge_requests/${mr.id}`),
        read: j => j.state && [j.state, j.draft && 'draft', j.detailed_merge_status, j.head_pipeline && `pipeline ${j.head_pipeline.status}`].filter(Boolean).join(' · '),
      },
      mr && {
        name: 'Its approvals',
        url: api(`${project(mr.path)}/merge_requests/${mr.id}/approvals`),
        read: j => typeof j.approved === 'boolean' && [
          j.approved ? 'approved' : 'not approved',
          Array.isArray(j.approved_by) && `by ${j.approved_by.length}`,
          j.approvals_left != null && `${j.approvals_left} left`,
        ].filter(Boolean).join(' · '),
      },
      pipeline && { name: 'A pipeline', url: api(`${project(pipeline.path)}/pipelines/${pipeline.id}`), read: j => j.status },
      job && { name: 'A job', url: api(`${project(job.path)}/jobs/${job.id}`), read: j => j.status },
    ].filter(Boolean);
  }
  const [build] = site.builds;
  return [
    {
      name: 'Signed in',
      url: `${site.base}/whoAmI/api/json`,
      read: j => (j.anonymous === false ? 'yes' : j.anonymous === true ? { fail: 'as anonymous: the session did not come along' } : null),
    },
    build && {
      name: 'A build',
      url: `${build}api/json?tree=number,result,building`,
      read: j => j.number != null && (j.building ? 'building' : String(j.result).toLowerCase()),
    },
  ].filter(Boolean);
}

const project = path => `/projects/${encodeURIComponent(path)}`;

// Jira turns down a POST made with a session unless it says it is no form submission.
const bulkFetch = (keys, fields) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
  body: JSON.stringify({ issueIdsOrKeys: keys, fields }),
});

// One request with the browser's cookies for the site. A redirect isn't followed: for an API it means a login
// page or an auth proxy in front of the site.
async function ask(fetchFn, url, init = {}, timeout) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), timeout);
  try {
    const res = await fetchFn(url, {
      ...init,
      credentials: 'include',
      redirect: 'manual',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...init.headers },
      signal: stop.signal,
    });
    if (res.type === 'opaqueredirect') return { redirect: true };
    const type = res.headers.get('content-type') || '';
    const json = type.includes('json') ? await res.json().catch(() => null) : null;
    return { status: res.status, json, page: type.includes('html') };
  } catch (e) {
    return { error: e.name === 'AbortError' ? `no answer in ${timeout / 1000} s` : `network error: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// The server's own words on an error: Jira's errorMessages or errors, GitLab's message or error.
function saidBy(j) {
  const said = j?.errorMessages?.[0] ?? (j?.errors && Object.values(j.errors)[0]) ?? j?.message ?? j?.error;
  return typeof said === 'string' ? said.slice(0, 120) : null;
}

const WHY = { 401: 'not signed in: the session did not come along', 403: 'forbidden', 404: 'not found' };

function outcome(check, answer) {
  if (answer.error) return { ok: false, text: answer.error };
  if (answer.redirect) return { ok: false, text: 'redirected, likely to a login page: the session did not come along' };
  if (answer.status < 200 || answer.status > 299) {
    return { ok: false, text: [`HTTP ${answer.status}`, WHY[answer.status], saidBy(answer.json)].filter(Boolean).join(' · ') };
  }
  if (!answer.json) {
    return { ok: false, text: answer.page ? `HTTP ${answer.status} with a web page instead of JSON (a login page?)` : `HTTP ${answer.status} without JSON` };
  }
  const got = check.read(answer.json);
  if (typeof got === 'string' && got) return { ok: true, text: got };
  return { ok: false, text: got?.fail ?? 'an answer of another shape' };
}

// Asks all of a site's questions at once: [{ name, ok, text }].
export async function probeSite(site, { fetch: fetchFn = globalThis.fetch, timeout = 8000 } = {}) {
  const checks = checksFor(site);
  const answers = await Promise.all(checks.map(c => ask(fetchFn, c.url, c.init, timeout)));
  return checks.map((c, i) => ({ name: c.name, ...outcome(c, answers[i]) }));
}

// ---- the watch ----
// The statuses live in maps by what they are about: tickets by key; merge requests, pipelines and jobs by their
// page's URL without the tail (".../-/merge_requests/42"); Jenkins builds and jobs (projects) by their URL.
// Each value carries `t`, when it last changed. `sites` says how each site answered.

export const MAPS = ['tickets', 'mrs', 'pipelines', 'jobs', 'builds', 'projects'];
// GitLab's states of a pipeline or a job that are still on their way, and of a job that is over.
export const ACTIVE = new Set(['created', 'waiting_for_resource', 'preparing', 'pending', 'running']);
const OVER = new Set(['success', 'failed', 'canceled', 'skipped']);
// How soon to ask again: while something runs; while it is open; once it is over. A page that is gone or not
// allowed, and a site that signed out or can't be reached, rest a while.
export const CADENCE = { active: 30_000, open: 120_000, done: 900_000, missing: 900_000, signedOut: 300_000, offline: 120_000 };

function dueIn(map, data) {
  if (map === 'tickets') return data.category === 'done' ? CADENCE.done : CADENCE.open;
  if (map === 'mrs') return ACTIVE.has(data.pipeline?.status) ? CADENCE.active : data.state === 'opened' ? CADENCE.open : CADENCE.done;
  if (map === 'pipelines' || map === 'jobs') return ACTIVE.has(data.status) ? CADENCE.active : CADENCE.done;
  if (map === 'builds') return data.building ? CADENCE.active : CADENCE.done;
  return data.building ? CADENCE.active : CADENCE.open; // a Jenkins job: its next build may start any time
}

const time = iso => (iso ? Date.parse(iso) : null);

function ticketOf(issue, me) {
  const { status, assignee, statuscategorychangedate: since } = issue.fields ?? {};
  if (!status) return null;
  return {
    name: status.name,
    category: status.statusCategory?.key ?? 'indeterminate',
    since: time(since),
    assignee: assignee ? { name: assignee.displayName ?? '', me: !!me && assignee.accountId === me } : null,
  };
}

// A stage is as far as its jobs are: running while one runs, failed when one failed that may not fail, and so on.
function stageStatus(jobs) {
  const any = (...states) => jobs.some(j => states.includes(j.status));
  if (any('running')) return 'running';
  if (jobs.some(j => j.status === 'failed' && !j.allow_failure)) return 'failed';
  if (any('created', 'waiting_for_resource', 'preparing', 'pending', 'scheduled')) return 'pending';
  if (any('canceled')) return 'canceled';
  if (jobs.every(j => j.status === 'skipped')) return 'skipped';
  if (jobs.every(j => ['manual', 'skipped'].includes(j.status))) return 'manual';
  return 'success';
}

function pipelineOf(p, jobs) {
  const counts = { total: 0, success: 0, failed: 0, running: 0, pending: 0, skipped: 0, manual: 0, canceled: 0, warnings: 0 };
  const stages = [];
  for (const j of [...(jobs ?? [])].sort((a, b) => a.id - b.id)) {
    counts.total++;
    if (j.status === 'failed' && j.allow_failure) counts.warnings++;
    else if (['created', 'waiting_for_resource', 'preparing', 'pending', 'scheduled'].includes(j.status)) counts.pending++;
    else if (j.status in counts) counts[j.status]++;
    let stage = stages.find(s => s.name === j.stage);
    if (!stage) stages.push((stage = { name: j.stage, jobs: [] }));
    stage.jobs.push(j);
  }
  const failed = j => j.status === 'failed' && !j.allow_failure;
  const named = test => (jobs ?? []).filter(test).map(j => j.name).slice(0, 5);
  return {
    id: p.id,
    status: p.status,
    warnings: p.detailed_status?.group === 'success-with-warnings' || counts.warnings > 0,
    startedAt: time(p.started_at),
    finishedAt: time(p.finished_at),
    duration: p.duration ?? null,
    // Each stage with its jobs over and in all, and which of them failed or run (since when).
    stages: stages.map(s => ({
      name: s.name,
      status: stageStatus(s.jobs),
      done: s.jobs.filter(j => OVER.has(j.status)).length,
      total: s.jobs.length,
      failed: s.jobs.filter(failed).map(j => j.name),
      running: s.jobs.filter(j => j.status === 'running').map(j => ({ name: j.name, startedAt: time(j.started_at) })),
    })),
    jobs: jobs ? counts : null,
    failed: named(failed),
    running: named(j => j.status === 'running'),
  };
}

function mrOf(m, approvals, pipeline) {
  return {
    state: m.state,
    draft: !!(m.draft ?? m.work_in_progress),
    merge: m.detailed_merge_status ?? m.merge_status ?? null,
    conflicts: !!m.has_conflicts,
    threadsResolved: m.blocking_discussions_resolved !== false,
    approved: approvals ? !!approvals.approved : null,
    approvalsLeft: approvals?.approvals_left ?? null,
    approvedBy: approvals?.approved_by?.length ?? null,
    pipeline,
  };
}

const jobOf = j => ({
  status: j.status,
  name: j.name,
  stage: j.stage,
  allowFailure: !!j.allow_failure,
  pipelineId: j.pipeline?.id ?? null,
  startedAt: time(j.started_at),
  finishedAt: time(j.finished_at),
  duration: j.duration ?? null,
});

const buildOf = b => ({
  number: b.number,
  building: !!b.building,
  result: b.result ?? null,
  startedAt: b.timestamp ?? null,
  estimate: b.estimatedDuration > 0 ? b.estimatedDuration : null,
  duration: b.duration || null,
});

// A Jenkins job's builds before this one, finished, newest first: for the details card.
const recentOf = (builds = [], number) => builds
  .filter(b => b.number !== number && !b.building)
  .slice(0, 3)
  .map(b => ({ number: b.number, result: b.result ?? null, startedAt: b.timestamp ?? null, duration: b.duration || null }));

// An answer, sorted for the watch: { json }, or what went wrong: the site (`trouble`: signed out, offline), the
// page (`missing`: gone or not allowed), or this once (`failed`).
async function answerOf(get, url, init) {
  const a = await get(url, init);
  if (a.error) return { trouble: 'offline' };
  if (a.redirect || a.status === 401) return { trouble: 'signed out' };
  if ([403, 404, 410].includes(a.status)) return { missing: true };
  if (a.status < 200 || a.status > 299) return { failed: true };
  if (!a.json) return a.page ? { trouble: 'signed out' } : { failed: true };
  return { json: a.json };
}

// JSON with every object's keys sorted: Opera's storage gives objects back with their keys in alphabetical order, so
// the order says nothing, and comparing plain JSON would see a change in every stored status.
export const canon = value => JSON.stringify(value, (_, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  : v));

const same = (known, data) => {
  const { t, t0, ...rest } = known;
  return canon(rest) === canon(data);
};

// A pipeline's jobs are asked for again only when it is another pipeline, it changed, or it is still running.
async function pipelineWith(site, path, p, known, ask) {
  if (!p) return { data: null };
  if (known?.id === p.id && known.status === p.status && known.jobs && !ACTIVE.has(p.status)) {
    const { t, t0, ...rest } = known;
    return { data: rest };
  }
  const jobs = await ask(`${site.base}/api/v4${project(path)}/pipelines/${p.id}/jobs?per_page=100`);
  if (jobs.trouble) return jobs;
  return { data: pipelineOf(p, jobs.json ?? null) };
}

// The pages of a GitLab or Jenkins site to ask about, one request chain each: { map, id, fetch(known) }.
function itemsOf(site, ask) {
  if (site.kind === 'jenkins') {
    // One request per Jenkins job: its name and its last builds, which hold a build tab's build as a rule.
    const fields = 'number,result,building,timestamp,estimatedDuration,duration';
    const history = job => ask(`${job}api/json?tree=name,builds[${fields}]{0,6}`);
    const build = url => async () => {
      const number = Number(url.match(/\/(\d+)\/$/)[1]);
      const job = await history(url.replace(/\d+\/$/, ''));
      if (!job.json) return job;
      let b = job.json.builds?.find(x => x.number === number);
      if (!b) {
        const own = await ask(`${url}api/json?tree=${fields}`);
        if (!own.json) return own;
        b = own.json;
      }
      return { data: { ...buildOf(b), job: job.json.name ?? null, recent: recentOf(job.json.builds, number) } };
    };
    const lastOf = url => async () => {
      const job = await history(url);
      if (!job.json) return job;
      const [last] = job.json.builds ?? [];
      if (!last) return { missing: true };
      return { data: { ...buildOf(last), job: job.json.name ?? null, recent: recentOf(job.json.builds, last.number) } };
    };
    return [
      ...site.builds.map(url => ({ map: 'builds', id: url, fetch: build(url) })),
      ...site.projects.map(url => ({ map: 'projects', id: url, fetch: lastOf(url) })),
    ];
  }
  const api = path => `${site.base}/api/v4${path}`;
  const page = (path, type, id) => `${site.origin}/${path}/-/${type}/${id}`;
  return [
    ...site.mrs.map(({ path, id }) => ({
      map: 'mrs',
      id: page(path, 'merge_requests', id),
      async fetch(known) {
        const mr = await ask(api(`${project(path)}/merge_requests/${id}`));
        if (!mr.json) return mr;
        const approvals = mr.json.state === 'opened' ? await ask(api(`${project(path)}/merge_requests/${id}/approvals`)) : null;
        if (approvals?.trouble) return approvals;
        const pipeline = await pipelineWith(site, path, mr.json.head_pipeline, known?.pipeline, ask);
        if (pipeline.trouble) return pipeline;
        return { data: mrOf(mr.json, approvals?.json ?? null, pipeline.data) };
      },
    })),
    ...site.pipelines.map(({ path, id }) => ({
      map: 'pipelines',
      id: page(path, 'pipelines', id),
      async fetch(known) {
        const p = await ask(api(`${project(path)}/pipelines/${id}`));
        return p.json ? pipelineWith(site, path, p.json, known, ask) : p;
      },
    })),
    ...site.jobs.map(({ path, id }) => ({
      map: 'jobs',
      id: page(path, 'jobs', id),
      async fetch() {
        const j = await ask(api(`${project(path)}/jobs/${id}`));
        return j.json ? { data: jobOf(j.json) } : j;
      },
    })),
  ];
}

// The ids a site's pages are kept under, to carry them over while the site rests.
const idsOf = site => [
  ...site.keys.map(k => ['tickets', k]),
  ...itemsOf(site, null).map(i => [i.map, i.id]),
];

async function pool(items, size, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

// Jira answers for all the due tickets at once, 100 per request. `me` (who the session is) is asked once.
async function pollJira(site, round) {
  const keys = site.keys.filter(k => !round.fresh('tickets', k));
  const troubled = (trouble, rest) => {
    for (const k of rest) round.carry('tickets', k);
    return trouble;
  };
  if (!keys.length) return null;
  if (round.memo.me[site.base] == null) {
    const who = await round.ask(`${site.base}/rest/api/3/myself`);
    if (who.trouble) return troubled(who.trouble, keys);
    round.memo.me[site.base] = who.json?.accountId ?? '';
  }
  const me = round.memo.me[site.base];
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const answer = await round.ask(`${site.base}/rest/api/3/issue/bulkfetch`, bulkFetch(chunk, ['status', 'assignee', 'statuscategorychangedate']));
    if (answer.trouble) return troubled(answer.trouble, keys.slice(i));
    if (!answer.json) {
      for (const k of chunk) answer.missing ? round.gone('tickets', k) : round.retry('tickets', k);
      continue;
    }
    const issues = new Map((answer.json.issues ?? []).map(issue => [issue.key, issue]));
    for (const k of chunk) {
      const data = issues.has(k) && ticketOf(issues.get(k), me);
      if (data) round.store('tickets', k, data);
      else round.gone('tickets', k);
    }
  }
  return null;
}

async function pollSite(site, round) {
  const rest = round.memo.due[`site ${site.base}`];
  if (rest > round.now) {
    round.next.due[`site ${site.base}`] = rest;
    round.status.sites[site.base] = round.previous.sites?.[site.base] ?? { kind: site.kind, ok: false, error: 'offline' };
    for (const [map, id] of idsOf(site)) round.carry(map, id);
    return;
  }
  let trouble = null;
  if (site.kind === 'jira') {
    trouble = await pollJira(site, round);
  } else {
    const items = itemsOf(site, round.ask).filter(i => !round.fresh(i.map, i.id));
    await pool(items, 4, async item => {
      if (trouble) return round.carry(item.map, item.id);
      const answer = await item.fetch(round.previous[item.map]?.[item.id]);
      if (answer.trouble) {
        trouble ??= answer.trouble;
        return round.carry(item.map, item.id);
      }
      if (answer.missing) return round.gone(item.map, item.id);
      if (answer.failed) return round.retry(item.map, item.id);
      round.store(item.map, item.id, answer.data);
    });
  }
  if (trouble) round.next.due[`site ${site.base}`] = round.now + (trouble === 'signed out' ? CADENCE.signedOut : CADENCE.offline);
  round.status.sites[site.base] = trouble ? { kind: site.kind, ok: false, error: trouble } : { kind: site.kind, ok: true };
  // `checked` is when the site last answered: in trouble, its statuses are as of then.
  if (!trouble) round.next.checked[site.base] = round.now;
}

const empty = () => Object.fromEntries(['sites', ...MAPS].map(m => [m, {}]));

function sameStatus(a, b) {
  return ['sites', ...MAPS].every(m => {
    const x = a[m] ?? {};
    const y = b[m] ?? {};
    const keys = Object.keys(x);
    return keys.length === Object.keys(y).length && keys.every(k => canon(x[k]) === canon(y[k]));
  });
}

// One round of the watch over the connected `sites` (from detectSites() with no limit). `previous` is the last
// stored status; `memo` is what the watch keeps meanwhile: when each page and site is due again (`due`), who the
// session is on each Jira site (`me`), when each site last answered (`checked`). Only what is due is asked for;
// pages no longer in any tab drop out. Returns the new status and memo, and whether the status changed.
export async function pollSites({ sites, previous = {}, memo = {}, now = Date.now(), fetch: fetchFn = globalThis.fetch, timeout = 8000 }) {
  const status = empty();
  const next = { due: {}, me: { ...memo.me }, checked: {} };
  const was = { due: memo.due ?? {}, me: next.me };
  const key = (map, id) => `${map} ${id}`;
  const round = {
    status,
    next,
    previous,
    now,
    memo: was,
    ask: (url, init) => answerOf((u, i) => ask(fetchFn, u, i, timeout), url, init),
    // Not due yet: kept as it is.
    fresh(map, id) {
      if (!(was.due[key(map, id)] > now)) return false;
      round.carry(map, id);
      return true;
    },
    carry(map, id) {
      const known = previous[map]?.[id];
      if (known) status[map][id] = known;
      if (was.due[key(map, id)]) next.due[key(map, id)] = was.due[key(map, id)];
    },
    // `t0` is when the page's status was first known, `t` when it last changed.
    store(map, id, data) {
      const known = previous[map]?.[id];
      status[map][id] = known && same(known, data) ? known : { ...data, t0: known?.t0 ?? now, t: now };
      next.due[key(map, id)] = now + dueIn(map, data);
    },
    gone(map, id) {
      next.due[key(map, id)] = now + CADENCE.missing;
    },
    retry(map, id) {
      round.carry(map, id);
      next.due[key(map, id)] = now + CADENCE.open;
    },
  };
  for (const s of sites) next.checked[s.base] = memo.checked?.[s.base];
  await Promise.all(sites.map(site => pollSite(site, round)));
  for (const base of Object.keys(next.checked)) if (next.checked[base] == null) delete next.checked[base];
  return { status, memo: next, changed: !sameStatus(status, previous) };
}

// Statuses kept before the comparison above ignored key order were "changed" at every round, so their change times
// mean nothing: each value's first-known time is set to its last change, which drops the changed-while-away marks.
export const STATUS_FORMAT = 2;
export function forgetChanges(status) {
  const out = { ...status };
  for (const map of MAPS) {
    out[map] = Object.fromEntries(Object.entries(status[map] ?? {}).map(([id, v]) => [id, { ...v, t0: v.t ?? v.t0 }]));
  }
  return out;
}

// ---- reading the statuses ----

// What the watch keeps about a tab, as [map, id] pairs: its page's own (a merge request, pipeline, job, build or
// Jenkins job) first, then its ticket's.
export function watchedOf(tab) {
  const found = [];
  let url;
  try {
    url = new URL(tab.url || '');
  } catch {
    return found;
  }
  const gitlab = url.pathname.match(GITLAB_PAGE);
  const build = url.pathname.match(JENKINS_BUILD);
  const jenkinsJob = url.pathname.match(JENKINS_PROJECT);
  if (gitlab) found.push([GITLAB_MAPS[gitlab[2]], `${url.origin}/${gitlab[1]}/-/${gitlab[2]}/${gitlab[3]}`]);
  else if (build) found.push(['builds', `${url.origin}${build[1]}${build[2]}/${build[3]}/`]);
  else if (jenkinsJob) found.push(['projects', `${url.origin}${jenkinsJob[1]}${jenkinsJob[2]}/`]);
  const key = ticketKey(tab);
  if (key) found.push(['tickets', key]);
  return found;
}

const CATEGORY = { new: 'To Do', indeterminate: 'In Progress', done: 'Done' };
const BLOCKERS = {
  conflict: 'conflicts',
  need_rebase: 'needs a rebase',
  discussions_not_resolved: 'unresolved threads',
  blocked_status: 'blocked by another merge request',
  jira_association_missing: 'no Jira issue',
  requested_changes: 'changes requested',
};

function pipelineText(p) {
  if (!p) return 'no pipeline';
  const j = p.jobs;
  const over = j ? j.success + j.failed + j.skipped + j.canceled + j.warnings + j.manual : 0;
  if (ACTIVE.has(p.status)) {
    const stage = p.stages.find(s => s.status === 'running' || s.status === 'pending');
    return [`pipeline ${p.status}`, stage && `stage ${stage.name}`, j?.total && `${over} of ${j.total} jobs done`].filter(Boolean).join(', ');
  }
  if (p.status === 'failed') return `pipeline failed${p.failed.length ? `: ${p.failed.join(', ')}` : ''}`;
  if (p.status === 'success') return p.warnings ? 'pipeline passed with warnings' : 'pipeline passed';
  return `pipeline ${p.status}`;
}

const progress = (b, now) => (b.building && b.estimate && b.startedAt ? `, about ${Math.min(99, Math.round(((now - b.startedAt) / b.estimate) * 100))}%` : '');

// A line per status, for a tooltip or the report.
export function describeWatched(map, id, data, now = Date.now()) {
  const number = id.match(/\/(\d+)$/)?.[1];
  switch (map) {
    case 'tickets': {
      const who = data.assignee ? (data.assignee.me ? 'on you' : data.assignee.name) : 'unassigned';
      const category = CATEGORY[data.category] ?? data.category;
      return `${id}: ${data.name}${data.name === category ? '' : ` (${category})`} · ${who}`;
    }
    case 'mrs': {
      const state = data.state === 'opened' ? (data.draft ? 'draft' : 'open') : data.state;
      // Approvals only when some are asked for or given.
      const approvals = data.state !== 'opened' ? null
        : data.approved && data.approvedBy ? `approved by ${data.approvedBy}`
          : data.approved === false && data.approvalsLeft > 0 ? `${data.approvalsLeft} approval${data.approvalsLeft === 1 ? '' : 's'} left` : null;
      const blocker = data.state === 'opened' ? BLOCKERS[data.merge] : null;
      const pipeline = data.pipeline ? pipelineText(data.pipeline) : data.state === 'opened' && 'no pipeline';
      return [`Merge request !${number}`, [state, pipeline, approvals, blocker, data.state === 'opened' && data.merge === 'mergeable' && 'ready to merge'].filter(Boolean).join(' · ')].join(': ');
    }
    case 'pipelines':
      return `Pipeline #${number}: ${pipelineText(data).replace(/^pipeline /, '')}`;
    case 'jobs':
      return `Job #${number} ${data.name}: ${data.status}${data.allowFailure && data.status === 'failed' ? ' (allowed to fail)' : ''}, stage ${data.stage}`;
    default: {
      const what = map === 'builds' ? `Build #${data.number}` : `Last build #${data.number}`;
      return `${what}: ${data.building ? `building${progress(data, now)}` : String(data.result ?? 'no result').toLowerCase()}`;
    }
  }
}

// The lines of what the watch knows about a tab.
export function statusLines(tab, status, now = Date.now()) {
  return watchedOf(tab)
    .filter(([map, id]) => status?.[map]?.[id])
    .map(([map, id]) => describeWatched(map, id, status[map][id], now));
}

// What Opera is asked for, to let the extension request a site: its origin, any path.
export const originPattern = site => `${site.origin}/*`;

export const KIND_NAMES = { jira: 'Jira', gitlab: 'GitLab', jenkins: 'Jenkins' };
// The page to open for a site to show up with something to try.
export const PAGE_TO_OPEN = { jira: 'a ticket', gitlab: 'a merge request', jenkins: 'a build' };
