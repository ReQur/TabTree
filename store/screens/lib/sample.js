// The made-up content of the screenshots: the tabs of the sample window (with their titles and favicons), where
// they sit in the tree, and what the fake Jira, GitLab and Jenkins answer about them. Based on docs/UI.md › Sample
// content for mockups. Nothing here is real: hosts are *.example.com, tickets are PROJ-….

const JIRA = 'http://jira.example.com';
const GITLAB = 'http://gitlab.example.com';
const CI = 'http://ci.example.com';
const GRAFANA = 'http://grafana.example.com';

// Favicons: plain glyphs on colored tiles, 16×16, as SVG. Only their colors need to tell sites apart.
const tile = (fill, glyph, fill2 = fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${fill}"/><stop offset="1" stop-color="${fill2}"/></linearGradient></defs>
<rect width="16" height="16" rx="3.5" fill="url(#g)"/>${glyph}</svg>`;
const W = 'fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
export const FAVICONS = {
  // Tracker: a ticket (a card with a line).
  jira: tile('#3d7be8', `<path d="M8 3.2 12.8 8 8 12.8 3.2 8Z" fill="#fff"/><path d="M8 6.1 9.9 8 8 9.9 6.1 8Z" fill="#3d7be8"/>`, '#2456c4'),
  // Code review: a merge glyph.
  gitlab: tile('#f0703a', `<circle cx="5" cy="4.3" r="1.5" ${W}/><circle cx="5" cy="11.7" r="1.5" ${W}/><circle cx="11" cy="11.7" r="1.5" ${W}/><path d="M5 5.8v4.4M11 10.2V8.2c0-1.6-1-2.6-2.6-2.6H7" ${W}/>`, '#d9481f'),
  // CI server: a gear-like ring.
  ci: tile('#4b5563', `<circle cx="8" cy="8" r="3.2" ${W}/><path d="M8 2.6v1.6M8 11.8v1.6M2.6 8h1.6M11.8 8h1.6M4.2 4.2l1.1 1.1M10.7 10.7l1.1 1.1M4.2 11.8l1.1-1.1M10.7 5.3l1.1-1.1" ${W}/>`, '#2f3640'),
  // Dashboards: a chart line.
  grafana: tile('#f6b23c', `<path d="M3 11 6 7.5 8.5 9.5 13 4.5" ${W}/>`, '#e8662c'),
  wiki: tile('#14a38b', `<path d="M3.2 4.5c1.8-.6 3.4-.4 4.8.7 1.4-1.1 3-1.3 4.8-.7v7c-1.8-.6-3.4-.4-4.8.7-1.4-1.1-3-1.3-4.8-.7ZM8 5.2v7" ${W}/>`, '#0c7c6a'),
  mail: tile('#e5484d', `<rect x="3" y="4.5" width="10" height="7" rx="1.2" ${W}/><path d="m3.4 5 4.6 3.6L12.6 5" ${W}/>`, '#c62f3a'),
  chat: tile('#f59e0b', `<path d="M3.5 5.2c0-1 .8-1.7 1.7-1.7h5.6c1 0 1.7.8 1.7 1.7v3.6c0 1-.8 1.7-1.7 1.7H7.2L4.6 12.5v-2H5.2c-1 0-1.7-.8-1.7-1.7Z" fill="#fff"/>`, '#d97706'),
  music: tile('#ec4899', `<path d="M6.3 11V4.3l5.2-1v6.4" ${W}/><circle cx="5" cy="11.2" r="1.5" fill="#fff"/><circle cx="10.2" cy="9.9" r="1.5" fill="#fff"/>`, '#be185d'),
  bank: tile('#0f766e', `<path d="M3 6.2 8 3.4l5 2.8M4.4 7.4v4M8 7.4v4M11.6 7.4v4M3 12.6h10" ${W}/>`, '#115e59'),
  assistant: tile('#0ea5e9', `<path d="M8 3.2c.4 2.6 2.2 4.4 4.8 4.8-2.6.4-4.4 2.2-4.8 4.8-.4-2.6-2.2-4.4-4.8-4.8 2.6-.4 4.4-2.2 4.8-4.8Z" fill="#fff"/>`, '#0369a1'),
};

// The tabs of the sample window, in tab-strip order. `id` is local to this file; `under` is the local id of the
// tab it was opened from (its opener), `folder` the folder it is put into, `top` a place on the top level set by hand.
export const TABS = [
  { id: 'chat', pinned: true, url: 'http://chat.example.com/team', title: 'Team chat', icon: 'chat' },
  { id: 'mail', pinned: true, url: 'http://mail.example.com/inbox', title: 'Inbox – Mail', icon: 'mail' },
  { id: 'music', pinned: true, url: 'http://music.example.com/radio', title: 'Music', icon: 'music' },

  { id: 'lat', folder: 'dash', url: `${GRAFANA}/d/k9x2/checkout-latency`, title: 'Checkout latency - Dashboards - Grafana', icon: 'grafana' },
  { id: 'budget', folder: 'dash', url: `${GRAFANA}/d/p3m7/error-budget`, title: 'Error budget - Dashboards - Grafana', icon: 'grafana' },
  { id: 'p101', folder: 'rel', url: `${JIRA}/browse/PROJ-101`, title: '[PROJ-101] Payments initiative - Jira', icon: 'jira' },
  { id: 'p133', under: 'p101', url: `${JIRA}/browse/PROJ-133`, title: '[PROJ-133] Idempotency keys - Jira', icon: 'jira' },
  { id: 'mr798', under: 'p133', url: `${GITLAB}/shop/checkout/-/merge_requests/798`, title: 'PROJ-133: Idempotency keys (!798) · Merge requests · shop / checkout · GitLab', icon: 'gitlab' },
  { id: 'p140', under: 'p101', url: `${JIRA}/browse/PROJ-140`, title: '[PROJ-140] Retry policy epic - Jira', icon: 'jira' },
  { id: 'mr812', under: 'p140', url: `${GITLAB}/shop/checkout/-/merge_requests/812`, title: 'PROJ-140: Retry budget per client (!812) · Merge requests · shop / checkout · GitLab', icon: 'gitlab' },
  { id: 'mr820', under: 'p140', url: `${GITLAB}/shop/checkout/-/merge_requests/820`, title: 'Draft: PROJ-140: Backoff tuning (!820) · Merge requests · shop / checkout · GitLab', icon: 'gitlab' },
  { id: 'mr820d', under: 'p140', url: `${GITLAB}/shop/checkout/-/merge_requests/820/diffs`, title: 'Draft: PROJ-140: Backoff tuning (!820) · Merge requests · shop / checkout · GitLab', icon: 'gitlab' },
  { id: 'p151', under: 'p140', url: `${JIRA}/browse/PROJ-151`, title: '[PROJ-151] Jitter for retries - Jira', icon: 'jira' },
  { id: 'mr826', under: 'p151', url: `${GITLAB}/shop/payments/-/merge_requests/826`, title: 'PROJ-151: Jitter for retries (!826) · Merge requests · shop / payments · GitLab', icon: 'gitlab' },
  { id: 'p175', under: 'p101', url: `${JIRA}/browse/PROJ-175`, title: '[PROJ-175] Refund webhooks - Jira', icon: 'jira' },

  { id: 'nightly', folder: 'infra', url: `${CI}/job/nightly-build/128/`, title: 'nightly-build [Jenkins]', icon: 'ci' },
  { id: 'node', folder: 'infra', url: `${GRAFANA}/d/n0d3/node-exporter`, title: 'Node exporter - Dashboards - Grafana', icon: 'grafana' },
  { id: 'bank', folder: 'personal', url: 'http://bank.example.com/accounts', title: 'Online bank', icon: 'bank' },

  { id: 'mrs', top: true, url: `${GITLAB}/shop/checkout/-/merge_requests`, title: 'Merge requests · shop / checkout · GitLab', icon: 'gitlab' },
  { id: 'mr830', under: 'mrs', url: `${GITLAB}/shop/checkout/-/merge_requests/830`, title: 'PROJ-160: Rate limiter (!830) · Merge requests · shop / checkout · GitLab', icon: 'gitlab' },
  { id: 'wiki', top: true, url: 'http://wiki.example.com/release-checklist', title: 'Release checklist · Wiki', icon: 'wiki' },
  { id: 'ai', top: true, url: 'http://assistant.example.com/chat', title: 'Assistant chat', icon: 'assistant' },
];

// Folders, in the order they are made (folders sort by `created`). Colors are the nine Chromium group colors.
export const FOLDERS = [
  { id: 'rel', name: 'Release 2.4', color: 'purple', parent: null },
  { id: 'dash', name: 'Dashboards', color: 'pink', parent: 'rel' },
  { id: 'infra', name: 'Infra', color: 'cyan', parent: null },
  { id: 'personal', name: 'Personal', color: 'grey', parent: null },
];

// The tab in view: its row has the active fill and the accent pip.
export const ACTIVE = 'mr820';

// ---- what the fake sites answer ----
// Times are relative to `t0`, when the server started, so every answer stays the same between rounds of the watch
// (a changed answer would count as news).

const MIN = 60_000;
const iso = t => new Date(t).toISOString();

export function jiraIssues(t0) {
  const me = { accountId: 'u-me', displayName: 'Alex Rivera' };
  const sam = { accountId: 'u-sam', displayName: 'Sam Lee' };
  const kim = { accountId: 'u-kim', displayName: 'Kim Novak' };
  const issue = (key, name, category, assignee, sinceMin) => ({
    key,
    fields: {
      status: { name, statusCategory: { key: category } },
      assignee,
      statuscategorychangedate: iso(t0 - sinceMin * MIN),
    },
  });
  return {
    me,
    issues: [
      issue('PROJ-101', 'In Progress', 'indeterminate', me, 6 * 24 * 60),
      issue('PROJ-133', 'Done', 'done', kim, 26 * 60),
      issue('PROJ-140', 'In Progress', 'indeterminate', sam, 3 * 24 * 60),
      issue('PROJ-151', 'In Review', 'indeterminate', me, 5 * 60),
      issue('PROJ-160', 'In Review', 'indeterminate', sam, 90),
      issue('PROJ-175', 'To Do', 'new', null, 2 * 24 * 60),
    ],
  };
}

// GitLab: merge requests by "<project path> <iid>", with their approvals and their head pipeline's jobs.
export function gitlab(t0) {
  const at = min => iso(t0 - min * MIN);
  const job = (id, stage, name, status, startedMin, extra = {}) => ({
    id, stage, name, status, allow_failure: false,
    started_at: startedMin == null ? null : at(startedMin),
    finished_at: ['success', 'failed'].includes(status) ? at(Math.max(0, startedMin - 2)) : null,
    ...extra,
  });
  const pipelines = {
    5490: {
      pipeline: { id: 5490, status: 'success', started_at: at(26 * 60 + 12), finished_at: at(26 * 60), duration: 690 },
      jobs: [job(1, 'build', 'compile', 'success', 26 * 60 + 12), job(2, 'test', 'unit', 'success', 26 * 60 + 8), job(3, 'test', 'integration', 'success', 26 * 60 + 8)],
    },
    5540: {
      pipeline: { id: 5540, status: 'running', started_at: at(7), finished_at: null, duration: null },
      jobs: [
        job(11, 'build', 'compile', 'success', 7),
        job(12, 'build', 'lint', 'success', 7),
        job(13, 'test', 'unit', 'success', 5),
        job(14, 'test', 'contract', 'success', 5),
        job(15, 'test', 'integration', 'running', 4),
        job(16, 'test', 'e2e-checkout', 'running', 2),
        job(17, 'deploy', 'review-app', 'created', null),
      ],
    },
    5536: {
      pipeline: { id: 5536, status: 'success', started_at: at(95), finished_at: at(83), duration: 720 },
      jobs: [job(21, 'build', 'compile', 'success', 95), job(22, 'test', 'unit', 'success', 90), job(23, 'test', 'integration', 'success', 90)],
    },
    5521: {
      pipeline: { id: 5521, status: 'failed', started_at: at(34), finished_at: at(25), duration: 540 },
      jobs: [
        job(31, 'build', 'compile', 'success', 34),
        job(32, 'test', 'unit', 'success', 31),
        job(33, 'test', 'integration', 'failed', 31),
        job(34, 'test', 'lint', 'success', 31),
      ],
    },
    5552: {
      pipeline: { id: 5552, status: 'success', started_at: at(48), finished_at: at(37), duration: 660 },
      jobs: [job(41, 'build', 'compile', 'success', 48), job(42, 'test', 'unit', 'success', 45), job(43, 'test', 'integration', 'success', 45)],
    },
  };
  const user = n => ({ user: { id: n, username: `reviewer${n}` } });
  const mr = (project, iid, state, merge, pipelineId, approvals, extra = {}) => ({
    project, iid, approvals,
    json: {
      iid, state, draft: false, detailed_merge_status: merge, has_conflicts: false, blocking_discussions_resolved: true,
      head_pipeline: pipelines[pipelineId].pipeline,
      ...extra,
    },
  });
  const mrs = [
    mr('shop/checkout', 798, 'merged', 'not_open', 5490, null),
    mr('shop/checkout', 812, 'opened', 'ci_still_running', 5540, { approved: false, approvals_left: 1, approved_by: [user(1)] }),
    mr('shop/checkout', 820, 'opened', 'draft_status', 5536, { approved: true, approvals_left: 0, approved_by: [] }, { draft: true }),
    mr('shop/payments', 826, 'opened', 'need_rebase', 5521, { approved: false, approvals_left: 1, approved_by: [user(2)] }),
    mr('shop/checkout', 830, 'opened', 'mergeable', 5552, { approved: true, approvals_left: 0, approved_by: [user(1), user(3)] }),
  ];
  return { pipelines, mrs, user: { id: 7, username: 'alex' } };
}

// Jenkins: a job's last builds, newest first.
export function jenkins(t0) {
  return {
    'nightly-build': {
      name: 'nightly-build',
      builds: [
        { number: 128, building: true, result: null, timestamp: t0 - 9 * MIN, estimatedDuration: 15 * MIN, duration: 0 },
        { number: 127, building: false, result: 'SUCCESS', timestamp: t0 - 24 * 60 * MIN, estimatedDuration: 15 * MIN, duration: 14 * MIN },
        { number: 126, building: false, result: 'SUCCESS', timestamp: t0 - 48 * 60 * MIN, estimatedDuration: 15 * MIN, duration: 15 * MIN },
        { number: 125, building: false, result: 'FAILURE', timestamp: t0 - 72 * 60 * MIN, estimatedDuration: 15 * MIN, duration: 6 * MIN },
      ],
    },
  };
}
