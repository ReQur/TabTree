// Settings › Statuses (probe/panel.js in jsdom): the sites behind the tabs, Connect and Disconnect through
// Opera's optional permissions, Test from the background and from the panel, and the probe in the report.
import { check, wait, done } from './helpers/check.js';
import { loadPanel } from './helpers/panel-env.js';

const tab = (id, title, url, extra = {}) => ({ id, index: id, windowId: 1, title, url, active: false, pinned: false, groupId: -1, favIconUrl: '', lastAccessed: 100, workspaceId: 'w', ...extra });
const json = (status, body) => ({ type: 'basic', status, headers: { get: () => 'application/json' }, json: async () => body });
const asked = [];
const p = await loadPanel({
  tabs: [
    tab(1, '[PROJ-1] Rate limiter - Jira', 'https://jira.example.com/browse/PROJ-1'),
    tab(2, 'PROJ-1: Rate limiter (!42) · Merge requests · group / app · GitLab', 'https://gitlab.example.com/group/app/-/merge_requests/42'),
    tab(3, 'Latency - Dashboards - Grafana', 'https://grafana.example.com/d/lat', { active: true, lastAccessed: 900 }),
  ],
  store: { settings: { onboarded: true }, folders: {}, parents: {}, ranks: {} },
  granted: ['https://gitlab.example.com/*'],
  // The panel's own requests: Jira knows the session.
  fetch: async (url, init) => {
    asked.push({ url, init });
    if (url.endsWith('/myself')) return json(200, { accountId: 'a1' });
    if (url.includes('/issue/PROJ-1')) return json(200, { fields: { status: { name: 'In Review', statusCategory: { key: 'indeterminate' } } } });
    if (url.includes('/search/jql')) return json(200, { issues: [{}] });
    return json(403, { errorMessages: ['XSRF check failed'] });
  },
  // The background's answer to the probe: the session did not come along there.
  onMessage: m => m.type === 'probeApi' && {
    reply: { ok: true, kind: m.site.kind, origin: m.site.origin, t: Date.now(), results: [{ name: 'Signed in', ok: false, text: 'HTTP 401 · not signed in: the session did not come along' }] },
  },
});
const { $, permissions } = p;
const all = sel => [...p.w.document.querySelectorAll(sel)];
const site = host => $(`.site[data-site="https://${host}"]`);
const siteButtons = host => [...site(host).querySelectorAll('.head button')].map(b => b.textContent);
const press = (host, name) => [...site(host).querySelectorAll('.head button')].find(b => b.textContent === name).click();
const checks = (host, ctx) => [...[...site(host).querySelectorAll('.checks')].find(c => c.querySelector('.ctx').textContent.startsWith(ctx)).querySelectorAll('.check')]
  .map(c => `${c.classList.contains('bad') ? '✗' : '✓'} ${c.querySelector('b').textContent}: ${c.querySelector('span').textContent}`);

$('#open-settings').click();
check(`Settings lists the sites behind the tabs: ${all('.site').map(s => s.dataset.site)}`,
  all('.site').map(s => s.dataset.site).join() === 'https://jira.example.com,https://gitlab.example.com' && [...all('.sub')].some(s => s.textContent === 'Statuses (probe)'));
check(`with what the test asks for: «${site('jira.example.com').querySelector('.m').textContent}»`,
  site('jira.example.com').querySelector('.m').textContent === 'Asks for who you are, 1 ticket of the open tabs.');
const notes = all('.settings .wp-note').map(n => n.textContent);
check(`a kind with no open page says how to bring it in: «${notes.at(-1)}»`, notes.at(-1) === 'No Jenkins here: open a build, and its site shows up.');
check(`a site not given yet: ${siteButtons('jira.example.com')}; a given one: ${siteButtons('gitlab.example.com')}`,
  siteButtons('jira.example.com').join() === 'Connect' && siteButtons('gitlab.example.com').join() === 'Test,Disconnect');

permissions.answer = false;
press('jira.example.com', 'Connect');
await wait(300);
check(`Connect asks Opera for the site's origin: ${permissions.asked}`, permissions.asked.join() === 'https://jira.example.com/*');
check(`a refusal is said, and nothing changes: «${$('.toast')?.textContent}»`, $('.toast.err')?.textContent.includes('jira.example.com: access not given') && siteButtons('jira.example.com').join() === 'Connect');
permissions.answer = true;
press('jira.example.com', 'Connect');
await wait(300);
check(`given: Test and Disconnect: ${siteButtons('jira.example.com')}`, siteButtons('jira.example.com').join() === 'Test,Disconnect');

press('jira.example.com', 'Test');
check('while it runs, Test waits', siteButtons('jira.example.com')[0] === 'Testing…' && site('jira.example.com').querySelector('.head button').disabled);
await wait(300);
const probe = p.sent.find(m => m.type === 'probeApi');
check('Test asks the background about the site', probe?.site.base === 'https://jira.example.com' && probe.site.keys.join() === 'PROJ-1');
check(`the background's answer: ${checks('jira.example.com', 'From the background')}`,
  checks('jira.example.com', 'From the background').join() === '✗ Signed in: HTTP 401 · not signed in: the session did not come along');
check(`and the panel's own, beside it:\n  ${checks('jira.example.com', 'From this panel').join('\n  ')}`, checks('jira.example.com', 'From this panel').join('\n') === [
  '✓ Signed in: yes',
  '✓ A ticket: In Review · indeterminate',
  '✓ Search by JQL: 1 of 1 found',
  '✗ Bulk fetch (POST): HTTP 403 · forbidden · XSRF check failed',
].join('\n'));
check('the panel asked with the session too', asked.length === 4 && asked.every(a => a.init.credentials === 'include'));

$('#report').click();
await wait(100);
const report = p.copied.at(-1) ?? '';
check(`the report has the probe:\n${report.split('### Statuses probe')[1]}`,
  report.includes('- Statuses probe: permissions API yes; connected: https://gitlab.example.com/*, https://jira.example.com/*')
  && report.includes('- Jira https://jira.example.com: connected')
  && /  - background \d\d:\d\d:\d\d: ✗ Signed in: HTTP 401/.test(report)
  && /  - panel \d\d:\d\d:\d\d: ✓ Signed in: yes · ✓ A ticket: In Review · indeterminate/.test(report)
  && report.includes('- GitLab https://gitlab.example.com: connected'));

press('jira.example.com', 'Disconnect');
await wait(300);
check('Disconnect gives the access back', permissions.removed.join() === 'https://jira.example.com/*' && siteButtons('jira.example.com').join() === 'Connect');
done();
