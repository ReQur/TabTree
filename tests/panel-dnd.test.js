// The panel (probe/panel.js in jsdom): drawing folders and tickets, drag and drop, folder actions.
// The panel only sends messages; the checks look at what it sends.
import { check, wait, done } from './helpers/check.js';
import { loadPanel } from './helpers/panel-env.js';

const J = 'https://jira.example.com/browse/';
const G = 'https://gitlab.example.com/group/app/-/merge_requests/';
const tab = (id, title, url, extra = {}) => ({ id, index: id, windowId: 1, title, url, active: false, pinned: false, groupId: -1, favIconUrl: '', lastAccessed: 100, workspaceId: 'w', ...extra });
const store = {
  folders: { rel: { name: 'Release', color: 'blue', parent: null, created: 1 }, dash: { name: 'Dashboards', color: 'pink', parent: 'rel', created: 2 } },
  parents: { 1: 'f:rel', 2: 1, 5: 'f:dash', 6: 'f:dash' },
  ranks: {},
};
const p = await loadPanel({
  tabs: [
    tab(1, '[PROJ-1] Initiative - Jira', J + 'PROJ-1'),
    tab(2, '[PROJ-2] Epic - Jira', J + 'PROJ-2'),
    tab(3, 'PROJ-2: First MR (!5) · Merge requests · group / app · GitLab', G + '5'),
    tab(4, 'PROJ-2: Second MR (!6) · Merge requests · group / app · GitLab', G + '6'),
    tab(5, 'Dashboard A', 'https://grafana.example.com/a'),
    tab(6, 'Dashboard B', 'https://grafana.example.com/b'),
    tab(7, '[PROJ-9] Lone ticket - Jira', J + 'PROJ-9', { active: true, lastAccessed: 900 }),
  ],
  store,
  // The background would add a new folder to storage; the panel then opens it for renaming.
  onMessage: (m, s) => {
    if (m.type !== 'newFolder') return null;
    s.folders[m.id] = { name: m.name ?? 'New folder', color: 'grey', parent: m.parent ?? null, created: Date.now() };
    return 'folders';
  },
});
const text = r => [...r.children].map(c => (c.classList.contains('acts') ? '' : c.textContent)).filter(Boolean).join(' | ');
const depth = r => r.style.getPropertyValue('--d');
console.log(p.rows().map(r => `${depth(r)} ${'  '.repeat(depth(r))}${text(r)}`).join('\n'));

check('folders nest, tickets hang under tickets', depth(p.row('Dashboards')) === '1' && depth(p.row('Epic')) === '2');
check("a top-level folder with 2+ tabs is an island: a rail in its color, from its row to the island's last row",
  p.row('Release').classList.contains('head') && p.rows().filter(r => r.classList.contains('isl')).length === 8
  && p.rows().filter(r => r.classList.contains('c-blue') && r.classList.contains('isl')).length === 8
  && p.row('Second MR').classList.contains('end') && !p.row('Lone ticket').classList.contains('isl'));
const kind = p.row('First MR').querySelector('.kind');
check(`a page kind is an icon and the number, the words in its tooltip: «${kind?.textContent}»`, kind?.textContent === '!5' && kind.title === 'MR !5' && !!kind.querySelector('svg'));

p.fire(p.row('Dashboard B'), 'dragstart');
p.fire(p.row('Dashboard A'), 'dragover', 2);
check('upper edge: a line before the row, at its depth', !!p.row('Dashboard A').querySelector('.dl.before') && p.row('Dashboard A').classList.contains('drop-before'));
p.fire(p.row('Dashboard A'), 'dragover', 10);
check('middle: the row itself is marked', !p.$('.dl') && p.row('Dashboard A').classList.contains('drop-inside'));
p.fire(p.row('Dashboard B'), 'dragend');
check(`the drag image: favicon and title: «${p.dragImages.at(-1)?.textContent}»`, p.dragImages.at(-1)?.textContent === 'GDashboard B' && !p.dragImages.at(-1).querySelector('.count'));
await wait(150);
p.drag('Dashboard B', 'Dashboard A', 2);
check('upper edge: before, on the same level', p.last().nodes.join() === 't:6' && p.last().parent === 'f:dash' && p.last().order.join() === 't:6,t:5');
await wait(150);
p.drag('Lone ticket', 'Dashboards', 10);
check('middle: inside a folder, last', p.last().nodes.join() === 't:7' && p.last().parent === 'f:dash' && p.last().order.at(-1) === 't:7');
await wait(150);
check('a folder cannot go under a tab', p.drag('Dashboards', 'Initiative', 10) === false);
await wait(150);
p.drag('Second MR', 'First MR', 2);
check("a ticket's page is reordered among the ticket's pages", p.last().nodes.join() === 't:4' && p.last().parent === 't:2' && p.last().order.join() === 't:4,t:3');
await wait(150);
p.drag('Second MR', 'Dashboards', 10);
check("a ticket's page dragged elsewhere takes the ticket along", p.last().nodes.join() === 't:2' && p.last().parent === 'f:dash');
await wait(150);
check('nothing goes into its own branch', p.drag('Initiative', 'Epic', 10) === false);
await wait(150);
p.fire(p.row('Dashboard A'), 'dragstart');
const zone = p.$('.drop-zone');
p.fire(zone, 'dragover');
p.fire(zone, 'drop');
p.fire(p.row('Dashboard A'), 'dragend');
check('the zone below the list: last on the top level', p.last().nodes.join() === 't:5' && p.last().parent === 'root' && p.last().order.at(-1) === 't:5');
await wait(150);

p.$('#new-folder').click();
await wait(400);
const made = p.sent.find(m => m.type === 'newFolder');
check('"+ Folder" puts the new folder after the other top-level folders', made?.parent === null && made.order[0] === 'f:rel' && made.order[1] === `f:${made.id}`);
const input = p.$('input.rename');
check('the new folder opens for renaming', !!input);
input.value = 'Infra';
input.dispatchEvent(new p.w.FocusEvent('blur'));
await wait(100);
check('the name is kept when the field loses focus', p.last().type === 'renameFolder' && p.last().id === made.id && p.last().name === 'Infra');
await wait(300);

p.row('Release').querySelector('.dot').click();
await wait(50);
check('the folder glyph switches to the next color', p.last().type === 'colorFolder' && p.last().color === 'red');
p.hoverButton('Lone ticket', 'Put PROJ-9 into a new folder').click();
await wait(50);
check('"→ folder" puts a top-level ticket into a folder in its place', p.last().type === 'newFolder' && p.last().items.join() === 't:7' && p.last().order.includes(`f:${p.last().id}`) && !p.last().order.includes('t:7'));
p.more('Dashboards');
p.pick('Delete folder');
await wait(50);
check('"Delete folder" in the folder menu deletes it', p.last().type === 'deleteFolder' && p.last().id === 'dash');
done();
