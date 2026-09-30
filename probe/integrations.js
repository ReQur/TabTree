// A probe for statuses from Jira, GitLab and Jenkins: which of these sites are behind the open tabs, and can the
// extension read their APIs with the browser's own session, without tokens? It only reads: who you are, and a
// ticket, a merge request, a pipeline, a job or a build from the open tabs.
import { ticketKey } from './titles.js';

const SAMPLES = 5;
const JIRA_TITLE = /\s[-–—|]\s+(Jira|JIRA)$/;
const JENKINS_TITLE = /\[Jenkins\]$|\s[-–—]\s+Jenkins$/;
// GitLab's pages of a project are under "/<group>/<project>/-/".
const GITLAB_PAGE = /^\/(.+?)\/-\/(merge_requests|pipelines|jobs)\/(\d+)/;
// A Jenkins build: an optional context path, one or more "/job/<name>", then the build number.
const JENKINS_BUILD = /^(.*?)((?:\/job\/[^/]+)+)\/(\d+)(?:\/|$)/;
const JENKINS_ROOT = /^(.*?)\/(?:job|view|computer|manage|user|me)(?:\/|$)/;
// A host named after its tool (gitlab.example.com) says what it is on any page, whatever the page's title.
const namedFor = (host, tool) => host.split('.').includes(tool);

// The sites behind the tabs: { kind: 'jira' | 'gitlab' | 'jenkins', origin, base, keys, mrs, pipelines, jobs,
// builds }. `base` is where the API lives (Jenkins may sit under a path); the rest are a few pages to try.
export function detectSites(tabs) {
  const sites = new Map();
  const siteOf = (kind, origin, base = origin) => {
    const id = `${kind} ${base}`;
    if (!sites.has(id)) sites.set(id, { kind, origin, base, keys: [], mrs: [], pipelines: [], jobs: [], builds: [] });
    return sites.get(id);
  };
  const add = (list, item) => {
    if (list.length < SAMPLES && !list.some(x => JSON.stringify(x) === JSON.stringify(item))) list.push(item);
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
      const site = siteOf('gitlab', url.origin);
      add(site[{ merge_requests: 'mrs', pipelines: 'pipelines', jobs: 'jobs' }[type]], { path, id });
    } else if (/\s·\s+GitLab$/.test(title) || namedFor(url.hostname, 'gitlab')) {
      siteOf('gitlab', url.origin);
    } else if (/^\/browse\/[A-Z][A-Z0-9]+-\d+/.test(url.pathname) || url.hostname.endsWith('.atlassian.net') || JIRA_TITLE.test(title) || namedFor(url.hostname, 'jira')) {
      const site = siteOf('jira', url.origin);
      if (key) add(site.keys, key);
    } else if (JENKINS_TITLE.test(title) || namedFor(url.hostname, 'jenkins')) {
      // "/job/<name>/<number>/" alone could be any site's: the title or the host has to say Jenkins.
      const build = url.pathname.match(JENKINS_BUILD);
      const root = build ? build[1] : (url.pathname.match(JENKINS_ROOT)?.[1] ?? url.pathname.replace(/\/+$/, ''));
      const site = siteOf('jenkins', url.origin, url.origin + root);
      if (build) add(site.builds, `${url.origin}${build[1]}${build[2]}/${build[3]}/`);
    }
  }
  // Without an issue page open, the keys seen in other tabs (merge requests' titles) stand in.
  for (const site of sites.values()) {
    if (site.kind === 'jira' && !site.keys.length) site.keys = keys.slice(0, SAMPLES);
  }
  return [...sites.values()];
}

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
      // Jira turns down a POST made with a session unless it says it is no form submission.
      keys.length && {
        name: 'Bulk fetch (POST)',
        url: api('/issue/bulkfetch'),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
          body: JSON.stringify({ issueIdsOrKeys: keys, fields: ['status'] }),
        },
        read: found,
      },
    ].filter(Boolean);
  }
  if (site.kind === 'gitlab') {
    const api = path => `${site.base}/api/v4${path}`;
    const project = path => `/projects/${encodeURIComponent(path)}`;
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

// What Opera is asked for, to let the extension request a site: its origin, any path.
export const originPattern = site => `${site.origin}/*`;

export const KIND_NAMES = { jira: 'Jira', gitlab: 'GitLab', jenkins: 'Jenkins' };
// The page to open for a site to show up with something to try.
export const PAGE_TO_OPEN = { jira: 'a ticket', gitlab: 'a merge request', jenkins: 'a build' };
