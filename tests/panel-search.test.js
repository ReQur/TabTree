// Search results (probe/panel.js in jsdom): the count line, the matches marked in the title, and under each
// result the path to it in the tree, or where else it is.
import { check, wait, done } from './helpers/check.js';
import { loadPanel } from './helpers/panel-env.js';

const J = 'https://jira.example.com/browse/';
const G = 'https://gitlab.example.com/group/app/-/merge_requests/';
const tab = (id, title, url, extra = {}) => ({ id, index: id, windowId: 1, title, url, active: false, pinned: false, groupId: -1, favIconUrl: '', lastAccessed: 100, workspaceId: 'w', ...extra });
const p = await loadPanel({
  tabs: [
    tab(1, '[PROJ-101] Release train - Jira', J + 'PROJ-101'),
    tab(2, '[PROJ-140] Epic - Jira', J + 'PROJ-140'),
    tab(3, 'PROJ-140: Fix the latency spike (!42) · Merge requests · group / app · GitLab', G + '42'),
    tab(4, 'Latency dashboard - Dashboards - Grafana', 'https://grafana.example.com/d/lat'),
    tab(5, 'Merge requests · GitLab', 'https://gitlab.example.com/dashboard/merge_requests'),
    tab(6, 'PROJ-7: Latency budget (!43) · Merge requests · group / app · GitLab', G + '43'),
    tab(7, 'Team chat', 'https://chat.example.com/', { pinned: true }),
    tab(8, 'Latency notes', 'https://notes.example.com/', { workspaceId: 'p', workspaceName: 'Personal' }),
    tab(9, 'Home', 'https://example.com/', { active: true, lastAccessed: 900 }),
  ],
  store: {
    folders: { rel: { name: 'Release 2.4', color: 'blue', parent: null, created: 1 } },
    parents: { 1: 'f:rel', 2: 1, 6: 5 },
    ranks: {},
    settings: { onboarded: true },
  },
});
const { $, search } = p;
const hits = () => [...p.w.document.querySelectorAll('#list .row.hit')];
const hit = text => hits().find(r => r.textContent.includes(text));
const crumbs = text => hit(text).querySelector('.crumbs').textContent;
const marks = text => [...hit(text).querySelectorAll('mark')].map(m => m.textContent).join();

search('latency');
check(`the count and the keys: «${$('.meta')?.textContent}»`, $('.meta')?.textContent === '4 tabs · ↑ ↓ move · Enter opens · Esc clears' && hits().length === 4);
check(`the match is marked in the title: ${marks('spike')}`, marks('spike') === 'latency' && hit('spike').querySelector('.key').textContent === 'PROJ-140');
check(`under it, the path in the tree: «${crumbs('spike')}»`, crumbs('spike') === 'Release 2.4 › PROJ-101 › PROJ-140');
check('with the color of the top-level folder', !!hit('spike').querySelector('.crumbs .dot'));
check(`a page without a key above a tab shows its title: «${crumbs('budget')}»`, crumbs('budget') === 'Merge requests');
check(`a top-level tab: «${crumbs('dashboard')}»`, crumbs('dashboard') === 'Top level' && !hit('dashboard').querySelector('.crumbs .dot'));
check(`a tab of another workspace: «${crumbs('notes')}»`, crumbs('notes') === 'Workspace Personal · opens there' && [...hit('notes').querySelectorAll('.badge')].some(b => b.textContent === 'Personal'));
search('team');
check(`a pinned tab: «${crumbs('Team')}»`, crumbs('Team') === 'Pinned');
search('LATENCY mr');
check(`every word must match; the marks ignore case: ${hits().length} hits, ${marks('spike')}`, hits().length === 2 && marks('spike') === 'latency' && marks('budget') === 'Latency');
search('fix spike');
check(`several words are all marked: ${marks('spike')}`, marks('spike') === 'Fix,spike');
search('zzz');
check(`no matches: «${$('#list .note')?.textContent}»`, $('#list .note')?.textContent.startsWith('No tabs match. Every word has to match a title, URL, ticket key or page kind') && !$('.meta'));

search('latency');
p.w.document.querySelector('#q').dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'ArrowDown' }));
p.w.document.querySelector('#q').dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Enter' }));
check('↓ and Enter open the second result', p.activated.at(-1) === 4);
p.rightClick(hit('spike'));
check(`right click on a result: the tab's menu: ${p.menu()}`, p.menu()?.[0] === 'Close tab');
p.key('Escape');
const native = p.rightClick(hit('notes'));
check('none for a tab of another workspace', !native.defaultPrevented && p.menu() === null);
p.key('Escape');
await wait(50);
check('Esc clears the search and shows the tree again', $('#q').value === '' && !hits().length && !!p.row('Release 2.4'));
done();
