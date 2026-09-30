// Statuses in the panel (probe/panel.js in jsdom): marks and lozenges in the rows, the line under a row, summaries on
// folders and folded rows, the status bar, the details card, a site in trouble, Settings › Statuses (sites,
// Connect, Sign in, Retry, Test, Disconnect, the switches), search by status, and the report.
import { check, wait, done } from './helpers/check.js';
import { loadPanel } from './helpers/panel-env.js';

const J = 'https://jira.example.com';
const G = 'https://gitlab.example.com';
const MR = n => `${G}/group/app/-/merge_requests/${n}`;
const BUILD = 'https://ci.example.com/job/nightly/128/';
const NOW = Date.now();
const T = NOW - 600_000; // ten minutes ago
const DAY = 86_400_000;
const tab = (id, title, url, extra = {}) => ({ id, index: id, windowId: 1, title, url, active: false, pinned: false, groupId: -1, favIconUrl: '', lastAccessed: 100, workspaceId: 'w', ...extra });
const json = (status, body) => ({ type: 'basic', status, headers: { get: () => 'application/json' }, json: async () => body });
const jobs = (over = {}) => ({ total: 0, success: 0, failed: 0, running: 0, pending: 0, skipped: 0, manual: 0, canceled: 0, warnings: 0, ...over });
const mr = over => ({ state: 'opened', draft: false, merge: 'mergeable', conflicts: false, threadsResolved: true, approved: true, approvalsLeft: 0, approvedBy: 1, pipeline: null, t0: T, t: T, ...over });

const asked = [];
const p = await loadPanel({
  tabs: [
    tab(1, '[PROJ-1] Rate limiter - Jira', `${J}/browse/PROJ-1`),
    tab(2, 'PROJ-1: Rate limiter (!42) · Merge requests · group / app · GitLab', MR(42)),
    tab(3, 'PROJ-7: Ledger (!43) · Merge requests · group / app · GitLab', MR(43)),
    tab(4, 'PROJ-8: Old fix (!44) · Merge requests · group / app · GitLab', MR(44)),
    tab(5, 'PROJ-9: Ready one (!45) · Merge requests · group / app · GitLab', MR(45)),
    tab(6, '[PROJ-2] Done ticket - Jira', `${J}/browse/PROJ-2`),
    tab(7, 'nightly #128 [Jenkins]', BUILD),
    tab(8, '[PROJ-3] Fresh ticket - Jira', `${J}/browse/PROJ-3`),
    tab(9, 'Latency - Dashboards - Grafana', 'https://grafana.example.com/d/lat', { active: true, lastAccessed: NOW }),
  ],
  store: {
    settings: { onboarded: true },
    folders: { rel: { name: 'Release', color: 'blue', parent: null, created: 1 } },
    parents: { 3: 'f:rel', 5: 'f:rel' },
    ranks: {},
    status: {
      sites: { [J]: { kind: 'jira', ok: true }, [G]: { kind: 'gitlab', ok: true } },
      tickets: {
        'PROJ-1': { name: 'In Review', category: 'indeterminate', since: NOW - 2 * DAY, assignee: { name: 'Me', me: true }, t0: T, t: T },
        'PROJ-2': { name: 'Done', category: 'done', since: T, assignee: null, t0: T, t: T },
      },
      mrs: {
        [MR(42)]: mr({
          merge: 'ci_still_running', approved: false, approvalsLeft: 1, approvedBy: 1,
          pipeline: {
            id: 5, status: 'running', warnings: false, startedAt: T, finishedAt: null, duration: null,
            stages: [
              { name: 'build', status: 'success', done: 2, total: 2, failed: [], running: [] },
              { name: 'test', status: 'running', done: 1, total: 3, failed: [], running: [{ name: 'integration', startedAt: T }] },
              { name: 'deploy', status: 'pending', done: 0, total: 1, failed: [], running: [] },
            ],
            jobs: jobs({ total: 6, success: 3, running: 1, pending: 2 }), failed: [], running: ['integration'],
          },
        }),
        // Failed ten minutes ago, after the tab was last looked at: changed while away.
        [MR(43)]: mr({
          draft: true, merge: 'need_rebase', approved: false, approvalsLeft: 2, approvedBy: 0, t0: T - 3_600_000,
          pipeline: {
            id: 6, status: 'failed', warnings: false, startedAt: T - 360_000, finishedAt: T, duration: 360,
            stages: [
              { name: 'build', status: 'success', done: 1, total: 1, failed: [], running: [] },
              { name: 'test', status: 'failed', done: 2, total: 2, failed: ['unit-tests'], running: [] },
            ],
            jobs: jobs({ total: 3, success: 2, failed: 1 }), failed: ['unit-tests'], running: [],
          },
        }),
        [MR(44)]: mr({ state: 'merged' }),
        [MR(45)]: mr({ approvedBy: 2, pipeline: { id: 7, status: 'success', warnings: false, startedAt: T, finishedAt: T, duration: 540, stages: [], jobs: jobs({ total: 4, success: 4 }), failed: [], running: [] } }),
      },
      pipelines: {},
      jobs: {},
      builds: {
        [BUILD]: {
          number: 128, building: true, result: null, startedAt: NOW - 240_000, estimate: 600_000, duration: null, job: 'nightly',
          recent: [{ number: 127, result: 'UNSTABLE', startedAt: NOW - DAY - 600_000, duration: 660_000 }], t0: T, t: T,
        },
      },
      projects: {},
    },
  },
  session: { watch: { due: {}, me: {}, checked: { [J]: NOW - 12_000, [G]: NOW - 20_000 } } },
  granted: [`${J}/*`, `${G}/*`],
  fetch: async (url, init) => {
    asked.push({ url, init });
    if (url.endsWith('/myself')) return json(200, { accountId: 'a1' });
    if (url.includes('/issue/PROJ-1')) return json(200, { fields: { status: { name: 'In Review', statusCategory: { key: 'indeterminate' } } } });
    if (url.includes('/search/jql')) return json(200, { issues: [{}] });
    return json(403, { errorMessages: ['XSRF check failed'] });
  },
  // The background answers the probe, and keeps the answer, as it does.
  onMessage: (m, s) => {
    if (m.type !== 'probeApi') return null;
    const entry = { kind: m.site.kind, origin: m.site.origin, t: Date.now(), results: [{ name: 'Signed in', ok: true, text: 'yes' }] };
    s.apiProbe = { ...s.apiProbe, [m.site.base]: entry };
    return { reply: { ok: true, ...entry }, changed: 'apiProbe' };
  },
});
const { $, store, permissions } = p;
const all = sel => [...p.w.document.querySelectorAll(sel)];
const rowOf = id => $(`#list .row[data-ref="t:${id}"]`);
const marks = id => [...(rowOf(id)?.querySelectorAll('.stc > *') ?? [])]
  .map(e => (e.tagName === 'svg' ? `<${e.getAttribute('class').replace('i st ', '')}>` : `${e.className}${e.textContent ? `:${e.textContent}` : ''}`)).join(' ');
const bar = id => rowOf(id)?.querySelector('.pbar');
const statusBar = () => all('#stsum button').map(b => b.textContent);
const hover = target => target.dispatchEvent(new p.w.MouseEvent('mouseenter'));
const lines = () => all('.pop .ln').map(l => [l.querySelector('.grow')?.textContent, l.querySelector('.r')?.textContent].filter(Boolean).join(' · '));

// ---- rows ----
check(`a ticket's root: its status as a lozenge, and the dot when it is on you: ${marks(1)}`, marks(1) === 'me js prog:In Review');
check(`a merge request whose pipeline runs: approvals, then the running mark: ${marks(2)}`, marks(2) === 'n opt:1/2 <run spin>');
check(`and the line under it, as far as its jobs: ${bar(2)?.querySelector('i')?.style.width}`, bar(2) && !bar(2).classList.contains('fail') && bar(2).querySelector('i').style.width === '50%');
check(`failed and needs a rebase, changed while away: ${marks(3)}`, marks(3) === 'chg fail <warn> <fail>' && bar(3)?.classList.contains('fail'));
check(`merged: its mark, and the row is dimmed: ${marks(4)}`, marks(4) === '<merged>' && rowOf(4).classList.contains('fin') && !bar(4));
check(`ready to merge: ${marks(5)}`, marks(5) === 'n opt ready:ready <ok>' && !bar(5));
check(`a done ticket: dimmed: ${marks(6)}`, marks(6) === 'js done:Done' && rowOf(6).classList.contains('fin'));
check(`a Jenkins build: time left, the running mark, the line by its estimate: ${marks(7)}`, marks(7) === 'n opt:~6 min <run spin>' && bar(7).querySelector('i').style.width === '40%');
check(`a ticket of a connected Jira not known yet: ${marks(8)}`, marks(8) === '<unk>');
check('a page of no watched site: nothing', !rowOf(9).querySelector('.stc') && !bar(9));
check(`a row's own tooltip is its title and address only: the card tells the status: ${JSON.stringify(rowOf(3).title)}`,
  rowOf(3).title === `PROJ-7: Ledger (!43) · Merge requests · group / app · GitLab\n${MR(43)}`);
const order = [...rowOf(2).children].map(c => c.className);
check(`the marks sit before the actions: ${order.join(' | ')}`, order.findIndex(c => c === 'stc') < order.findIndex(c => c === 'acts'));
const folder = $('#list .row[data-folder="rel"]');
check(`a folder sums up what failed and what runs in it: ${folder.querySelector('.sum')?.title}`, folder.querySelector('.sum .fail')?.textContent === '1' && !folder.querySelector('.sum .run'));
rowOf(1).querySelector('.twisty').click();
await wait(50);
check(`a folded row sums up its branch: ${rowOf(1).querySelector('.sum')?.title}`, rowOf(1).querySelector('.sum .run')?.textContent === '1');
rowOf(1).querySelector('.twisty').click();
await wait(50);

// ---- the status bar ----
check(`the status bar: ${statusBar().join(' | ')}`, statusBar().join(' | ') === '1 failed | 2 running | 2 finished');
all('#stsum button').find(b => b.textContent === '1 failed').click();
await wait(50);
check(`"failed" searches for it: ${all('#list .row.hit').length} hit`, $('#q').value === 'failed' && all('#list .row.hit').length === 1 && all('#list .row.hit')[0].textContent.includes('Ledger'));
p.key('Escape');
await wait(50);
all('#stsum button').find(b => b.textContent === '2 finished').click();
check(`"finished" offers to close them: ${p.menu()}`, p.menu()?.join() === 'Close 2 finished tabs');
p.pick('Close 2 finished tabs');
check(`which closes the merged merge request and the done ticket: ${p.removed}`, p.removed.join() === '4,6');

// ---- the details card ----
hover(rowOf(2).querySelector('.stc'));
await wait(450);
check(`hovering a status opens its card: ${$('.pop .ph')?.textContent}`, $('.pop .ph .grow')?.textContent === '!42 Rate limiter');
check(`the pipeline, stage by stage, and the merge:\n  ${all('.pop .lbl').map(l => l.textContent).join('\n  ')}\n  ${lines().join('\n  ')}`,
  all('.pop .lbl').map(l => l.textContent).join() === 'Pipeline #5 · running for 10 min,Merge'
  && lines().join('|') === 'build · 2/2|test · 1/3 · 1 running|integration · 10 min|deploy · waiting|Waits for the pipeline|Approvals · 1 of 2'
  && $('.pop .meter i')?.style.width === '50%');
check(`the footer: where from, how fresh, and the pipeline: ${$('.pop .pf')?.textContent}`, /^gitlab\.example\.com · checked 2\d s ago$/.test($('.pop .pf span').textContent) && $('.pop .pf button').textContent === 'Open pipeline');
rowOf(2).querySelector('.stc').dispatchEvent(new p.w.MouseEvent('mouseleave'));
await wait(250);
check('leaving closes it', !$('.pop'));
rowOf(3).querySelector('.stc').click();
check(`a click pins the card at once: ${$('.pop .pm')?.textContent}`, $('.pop .pm')?.textContent === 'PROJ-7 · open · failed 10 min ago, while you were away' && all('.pop .badge').map(b => b.textContent).join() === 'draft');
check(`what failed, and why it can't merge: ${lines().join(' | ')}`, lines().includes('unit-tests') && lines().includes('Needs a rebase') && lines().includes('Approvals · 0 of 2'));
rowOf(3).querySelector('.stc').dispatchEvent(new p.w.MouseEvent('mouseleave'));
await wait(250);
check('a pinned card stays', !!$('.pop'));
$('.pop .pf button').click();
check(`"Open pipeline" has the background open it under the merge request: ${JSON.stringify(p.last())}`,
  p.last().type === 'openTab' && p.last().url === `${G}/group/app/-/pipelines/6` && p.last().parent === 3 && !$('.pop'));
rowOf(1).querySelector('.stc').click();
check(`a ticket's card: ${$('.pop .ph')?.textContent} · ${$('.pop .lz')?.textContent}\n  ${lines().join('\n  ')}`,
  $('.pop .key')?.textContent === 'PROJ-1' && $('.pop .ph .grow').textContent === 'Rate limiter' && $('.pop .lz').textContent === 'In Reviewfor 2 days'
  && lines().join('|') === 'Assigned to you|Status changed 2 days ago|Open merge requests under it · 1');
p.key('Escape');
check('Esc closes a card', !$('.pop'));
rowOf(7).querySelector('.stc').click();
check(`a build's card: ${$('.pop .ph')?.textContent} · ${$('.pop .pm')?.textContent}\n  ${lines().join('\n  ')}`,
  $('.pop .ph .grow')?.textContent === 'nightly #128' && $('.pop .pm').textContent === 'building · started 4 min ago'
  && lines().join('|') === 'About 6 min left · estimate 10 min|#127 unstable · 24 h ago · 11 min' && all('.pop .lbl').map(l => l.textContent).join() === 'Last builds');
p.mousedown(p.$('#stats'));
check('a click elsewhere closes it', !$('.pop'));
hover(rowOf(3).querySelector('.kind'));
await wait(450);
check(`the page kind opens the card too, without its own tooltip: ${$('.pop .ph .grow')?.textContent}`, $('.pop .ph .grow')?.textContent === '!43 Ledger' && rowOf(3).querySelector('.kind').title === '');
p.key('Escape');
hover(rowOf(5).querySelector('.stc'));
p.notify('status');
await wait(500);
check(`the tree redrawn meanwhile: the card still opens: ${$('.pop .ph .grow')?.textContent}`, $('.pop .ph .grow')?.textContent === '!45 Ready one' && lines().includes('Ready to merge'));
p.key('Escape');

// ---- the switches ----
store.settings = { ...store.settings, markChanged: false, dimFinished: false };
p.notify('settings');
await wait(300);
check('without "Mark what changed", no dot; without "Dim finished rows", no dimming', !rowOf(3).querySelector('.chg') && !rowOf(4).classList.contains('fin'));

// ---- a site in trouble ----
store.status = { ...store.status, sites: { ...store.status.sites, [G]: { kind: 'gitlab', ok: false, error: 'signed out' } } };
p.notify('status');
await wait(300);
check(`signed out: a banner above the tree: «${$('.stbanner')?.textContent}»`, /^Signed out of gitlab\.example\.com\. Its statuses are from \d\d:\d\d:\d\d\. Sign in$/.test($('.stbanner')?.textContent ?? ''));
check('its statuses are the last known, dimmed', rowOf(2).querySelector('.stc').classList.contains('stale') && bar(2).classList.contains('stale') && !rowOf(1).querySelector('.stc').classList.contains('stale'));
check(`and the status bar says so first: ${statusBar()[0]}`, statusBar()[0] === 'GitLab: sign in' && $('#stsum button').classList.contains('warn'));
$('.stbanner .link').click();
check('"Sign in" opens the site, on the top level', p.last().type === 'openTab' && p.last().url === `${G}/` && p.last().parent === -1);
rowOf(2).querySelector('.stc').click();
check(`its card says so too: «${$('.pop .banner')?.textContent}»`, $('.pop .banner')?.textContent.startsWith('Signed out of gitlab.example.com. This is the last known status, from ') && !!$('.pop .stale'));
p.key('Escape');

// ---- Settings › Statuses ----
$('#open-settings').click();
const site = host => $(`.site[data-site="https://${host}"]`);
const state = host => site(host).querySelector('small').textContent;
const actions = host => [...site(host).querySelectorAll('.line > button')].map(b => b.getAttribute('aria-label') ?? b.textContent);
check(`the section and its switches: ${all('.settings .sub').map(e => e.textContent)}`,
  all('.settings .sub')[1]?.textContent === 'Statuses' && $('#set-statuses').checked && !$('#set-dim-finished').checked && !$('#set-mark-changed').checked);
check(`a site that answers: «${state('jira.example.com')}» ${actions('jira.example.com')}`, /^Connected · checked 1\d s ago · 2 tickets$/.test(state('jira.example.com')) && actions('jira.example.com').join() === 'More for jira.example.com');
check(`a site that signed out: «${state('gitlab.example.com')}» ${actions('gitlab.example.com')}`,
  /^Signed out · last known \d\d:\d\d:\d\d$/.test(state('gitlab.example.com')) && actions('gitlab.example.com').join() === 'Sign in,More for gitlab.example.com');
check(`a site not connected: «${state('ci.example.com')}» ${actions('ci.example.com')}`, state('ci.example.com') === 'Not connected: TabTree may not read this site' && actions('ci.example.com').join() === 'Connect');
[...site('ci.example.com').querySelectorAll('button')].find(b => b.textContent === 'Connect').click();
await wait(300);
check(`Connect asks Opera for the site: «${state('ci.example.com')}»`, permissions.asked.join() === 'https://ci.example.com/*' && state('ci.example.com') === 'Connected · checking…');

store.status = { ...store.status, sites: { ...store.status.sites, [G]: { kind: 'gitlab', ok: false, error: 'offline' } } };
p.notify('status');
await wait(300);
check(`unreachable: «${state('gitlab.example.com')}» ${actions('gitlab.example.com')}`, /^Offline · VPN\? last OK \d\d:\d\d:\d\d$/.test(state('gitlab.example.com')) && actions('gitlab.example.com')[0].endsWith('Retry'));
[...site('gitlab.example.com').querySelectorAll('button')].find(b => b.textContent.endsWith('Retry')).click();
check('Retry asks the background to ask it again now', p.last().type === 'retrySite' && p.last().base === G);

site('jira.example.com').querySelector('button[aria-label^="More"]').click();
check(`⋯ on a site: ${p.menu()}`, p.menu()?.join() === 'Test the connection,Disconnect');
p.pick('Test the connection');
await wait(300);
check('Test asks from the background and from the panel, and shows both', p.sent.some(m => m.type === 'probeApi' && m.site.base === J)
  && [...site('jira.example.com').querySelectorAll('.ctx')].map(c => c.textContent.split(' · ')[0]).join() === 'Test from the background,Test from this panel' && asked.length === 4);
site('jira.example.com').querySelector('button[aria-label^="More"]').click();
p.pick('Disconnect');
await wait(300);
check('Disconnect takes the access back', permissions.removed.join() === `${J}/*` && state('jira.example.com') === 'Not connected: TabTree may not read this site');

// ---- the report ----
$('#report').click();
await wait(100);
const report = p.copied.at(-1) ?? '';
check(`the report has the watch and the probe:\n${report.split('\n').filter(l => /Statuses|^- (Jira|GitLab) http|^ {2}- /.test(l)).join('\n')}`,
  /- Statuses watch: 2 tickets, 4 merge requests, 1 build; pipelines: 1 running, 1 failed, 1 success; sites: /.test(report)
  && /Jira ok at \d\d:\d\d:\d\d/.test(report) && /GitLab offline at \d\d:\d\d:\d\d/.test(report)
  && report.includes('- Merge request !43: draft · pipeline failed: unit-tests · 2 approvals left · needs a rebase (since ')
  && / {2}- background \d\d:\d\d:\d\d: ✓ Signed in: yes/.test(report));

$('#set-statuses').checked = false;
$('#set-statuses').dispatchEvent(new p.w.Event('change'));
await wait(300);
$('#back').click();
await wait(50);
check('statuses off: no marks, no lines, nothing in the status bar', !$('#list .stc') && !$('#list .pbar') && !statusBar().length && store.settings.statuses === false);
done();
