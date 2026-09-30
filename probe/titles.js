// Pure helpers that turn tab titles/URLs into ticket keys, compact row labels and island names.

const KEY_RE = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,7})\b/g;
// Uppercase-dash-number tokens that are not tracker keys.
const NOT_KEYS = new Set(['UTF', 'ISO', 'SHA', 'CVE', 'RFC', 'TLS', 'SSL', 'HTTP', 'COVID', 'GPT', 'WIN']);

const SUFFIXES = [
  // GitLab: "… (!842) · Merge requests · group / project · GitLab"
  /\s+·\s+(Merge requests|Issues|Pipelines|Jobs|Repository|Commits|Branches)\s+·\s+.*$/,
  /\s+·\s+GitLab$/,
  /\s+-\s+Dashboards\s+-\s+Grafana$/,
  /\s+[-–—|]\s+(JIRA|Jira|Grafana|Jenkins|GitLab)$/,
  /\s+\[Jenkins\]$/,
];

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

// Tabs with the same URL (ignoring the #fragment) are duplicates.
export function urlKey(tab) {
  return (tab.url || tab.pendingUrl || '').split('#')[0];
}

export function ticketKey(tab) {
  // URL path only: Jira boards carry "?selectedIssue=KEY-1" without being that issue's page.
  // A tab that is still loading has only pendingUrl.
  for (const s of [tab.title || '', pathOf(tab.url || tab.pendingUrl)]) {
    for (const m of s.matchAll(KEY_RE)) {
      if (!NOT_KEYS.has(m[1])) return `${m[1]}-${m[2]}`;
    }
  }
  return null;
}

export function cleanTitle(tab, key) {
  let text = tab.title || tab.url || '';
  for (const re of SUFFIXES) text = text.replace(re, '');
  const draftPrefix = text.match(/^(Draft|WIP):\s*/i);
  if (draftPrefix) text = text.slice(draftPrefix[0].length);
  if (key) text = text.replace(new RegExp(`^\\[?${key}\\]?:?\\s*`), '');
  return { text: text.trim() || tab.url || '', draft: !!draftPrefix };
}

// The kind of page a URL shows, in parts: `type` (mr, pipeline, job, build, jira), the `number` as shown
// (`!42`, `#900`), the merge request's `view` (changes, commits, pipelines) and the whole `label`.
export function pageKind(url = '') {
  const kind = (type, word, number, view) => ({
    type,
    number,
    view,
    label: [word, number].filter(Boolean).join(' ') + (view ? ` · ${view}` : ''),
  });
  let m;
  if ((m = url.match(/\/merge_requests\/(\d+)(?:\/(diffs|commits|pipelines))?/))) {
    return kind('mr', 'MR', `!${m[1]}`, m[2] && (m[2] === 'diffs' ? 'changes' : m[2]));
  }
  if ((m = url.match(/\/pipelines\/(\d+)/))) return kind('pipeline', 'pipeline', `#${m[1]}`);
  if ((m = url.match(/\/-\/jobs\/(\d+)/))) return kind('job', 'job', `#${m[1]}`);
  if ((m = url.match(/\/job\/[^/]+\/(\d+)(\/|$)/))) return kind('build', 'build', `#${m[1]}`);
  if (/\/browse\/[A-Z][A-Z0-9]+-\d+/.test(url)) return kind('jira', 'Jira');
  return null;
}

// What page a URL shows, to find it among the open tabs: a GitLab merge request, pipeline or job whatever part of it is
// in view (/diffs, /commits…), a Jira issue, a Jenkins build; any other page by its address without the #fragment.
export function pageIdentity(url = '') {
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const gitlab = u.pathname.match(/^\/(.+?)\/-\/(merge_requests|pipelines|jobs)\/(\d+)/);
  if (gitlab) return `${u.origin}/${gitlab[1]}/-/${gitlab[2]}/${gitlab[3]}`;
  const jira = u.pathname.match(/^\/browse\/([A-Z][A-Z0-9]+-\d+)/);
  if (jira) return `${u.origin}/browse/${jira[1]}`;
  const build = u.pathname.match(/^(.*?(?:\/job\/[^/]+)+)\/(\d+)(?:\/|$)/);
  if (build) return `${u.origin}${build[1]}/${build[2]}/`;
  return url.split('#')[0];
}

// The open tab to show a page in, instead of a new copy: one at the same address (without the #fragment), else one
// showing the same page (pageIdentity); the most recently used of them. Web pages outside incognito only.
export function tabToReuse(url, tabs, except) {
  const web = tabs.filter(t => t.id !== except && !t.incognito && /^https?:/.test(t.url || ''));
  const recent = list => list.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0] ?? null;
  const address = url.split('#')[0];
  const page = pageIdentity(url);
  return recent(web.filter(t => t.url.split('#')[0] === address)) ?? recent(web.filter(t => pageIdentity(t.url) === page));
}

// "MR !42 · changes", "pipeline #900", "Jira", or null.
export const kindLabel = url => pageKind(url)?.label ?? null;

function baseText(tab, key) {
  const { text } = cleanTitle(tab, key);
  // The MR number is shown as a badge, so drop GitLab's "(!842)" tail.
  return /\/merge_requests\/\d+/.test(tab.url || '') ? text.replace(/\s*\(!\d+\)$/, '') : text;
}

export function isIssuePage(tab, key) {
  return (tab.title || '').startsWith(`[${key}]`) || pathOf(tab.url) === `/browse/${key}`;
}

// Group header: the Jira issue's summary when its tab is open, otherwise the first tab's title.
export function groupTitle(tabs, key) {
  const jira = tabs.find(t => isIssuePage(t, key));
  return baseText(jira || tabs[0], key);
}

// Chromium tab group colors, in the API's order; a key always gets the same one.
const ISLAND_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

export function colorFor(key) {
  const hash = [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return ISLAND_COLORS[hash % ISLAND_COLORS.length];
}

function shorten(text, max = 40) {
  if (text.length <= max) return text;
  const space = text.lastIndexOf(' ', max);
  return `${text.slice(0, space > max / 2 ? space : max)}…`;
}

export const islandName = (key, summary) => `${key} ${shorten(summary)}`;

// A row inside a ticket group shows the page kind instead of repeating the header (`asKind`). `kind` is the
// page kind in parts (see pageKind), or null.
export function rowLabel(tab, key, header) {
  const { draft } = cleanTitle(tab, key);
  const text = baseText(tab, key);
  let kind = pageKind(tab.url);
  if (kind && text === header) return { text: kind.label, kind: null, draft, asKind: true };
  // Outside a group the Jira favicon already says it.
  if (header == null && kind?.type === 'jira') kind = null;
  return { text, kind, draft, asKind: false };
}
