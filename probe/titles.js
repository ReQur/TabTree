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

export function kindLabel(url = '') {
  let m;
  if ((m = url.match(/\/merge_requests\/(\d+)(?:\/(diffs|commits|pipelines))?/))) {
    return `MR !${m[1]}${m[2] ? ` · ${m[2] === 'diffs' ? 'changes' : m[2]}` : ''}`;
  }
  if ((m = url.match(/\/pipelines\/(\d+)/))) return `pipeline #${m[1]}`;
  if ((m = url.match(/\/-\/jobs\/(\d+)/))) return `job #${m[1]}`;
  if ((m = url.match(/\/job\/[^/]+\/(\d+)(\/|$)/))) return `build #${m[1]}`;
  if (/\/browse\/[A-Z][A-Z0-9]+-\d+/.test(url)) return 'Jira';
  return null;
}

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

// A row inside a ticket group shows the page kind instead of repeating the header.
export function rowLabel(tab, key, header) {
  const { draft } = cleanTitle(tab, key);
  const text = baseText(tab, key);
  let kind = kindLabel(tab.url);
  if (kind && text === header) return { text: kind, kind: null, draft };
  // Outside a group the Jira favicon already says it.
  if (header == null && kind === 'Jira') kind = null;
  return { text, kind, draft };
}
