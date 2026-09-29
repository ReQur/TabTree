// The panel's multi-select (probe/panel.js in jsdom): Ctrl/Shift clicks, the anchor, and the selection bar.
import { check, wait, done } from './helpers/check.js';
import { loadPanel } from './helpers/panel-env.js';

const J = 'https://jira.example.com/browse/';
const G = 'https://gitlab.example.com/group/app/-/merge_requests/';
const tab = (id, title, url, extra = {}) => ({ id, index: id, windowId: 1, title, url, active: false, pinned: false, groupId: -1, favIconUrl: '', lastAccessed: 100, workspaceId: 'w', ...extra });
// Drawn as: Dashboards, Dashboard A, Dashboard B, Ticket, Its MR, Loose one, Loose two.
const p = await loadPanel({
  tabs: [
    tab(1, 'Dashboard A', 'https://grafana.example.com/a'),
    tab(2, 'Dashboard B', 'https://grafana.example.com/b'),
    tab(3, '[PROJ-1] Ticket - Jira', J + 'PROJ-1'),
    tab(4, 'PROJ-1: Its MR (!4) · Merge requests · group / app · GitLab', G + '4'),
    tab(5, 'Loose one', 'https://example.com/1'),
    tab(6, 'Loose two', 'https://example.com/2', { active: true, lastAccessed: 900 }),
  ],
  store: { folders: { dash: { name: 'Dashboards', color: 'pink', parent: null, created: 1 } }, parents: { 1: 'f:dash', 2: 'f:dash' }, ranks: {} },
});
const { click, selected, $, last } = p;
const shift = (row, extra = {}) => click(row, { shiftKey: true, ...extra });

click('Loose one', { ctrlKey: true });
click('Dashboard A', { ctrlKey: true });
check(`Ctrl+click selects rows one by one: ${selected()}`, selected().join() === 'Dashboard A,Loose one' && !$('#selbar').hidden);
const bar = () => `${$('#sel-count').hidden ? '' : `${$('#sel-count').textContent}: `}${$('#sel-what').textContent}`;
check(`the selection bar counts them: «${bar()}»`, bar() === '2 selected: 2 tabs');
click('Dashboard A', { ctrlKey: true });
check('Ctrl+click on a selected row unselects it', selected().join() === 'Loose one');
shift('Dashboards');
check(`Shift+click selects from the last Ctrl-clicked row: ${selected()}`, selected().join() === 'Dashboards,Dashboard A');
check('a folder and a row inside it count once', bar() === '2 selected: 2 tabs, 1 folder');

click('Loose one');
check('a plain click clears the selection and opens the tab', selected().length === 0 && p.activated.at(-1) === 5 && $('#selbar').hidden);
shift('Dashboard B');
check(`Shift+click after a plain click starts from that row: ${selected()}`, selected().join() === 'Dashboard B,Ticket,Its MR,Loose one');
p.w.document.querySelector('#list').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true }));
check('a click on the empty list clears the selection', selected().length === 0);
shift('Its MR');
check(`after that, Shift+click selects just one row: ${selected()}`, selected().join() === 'Its MR');
shift('Loose two');
check(`which is the new anchor: ${selected()}`, selected().join() === 'Its MR,Loose one,Loose two');
shift('Dashboard A', { ctrlKey: true });
check(`Ctrl+Shift+click adds a range: ${selected()}`, selected().join() === 'Dashboard A,Dashboard B,Ticket,Its MR,Loose one,Loose two');
p.key('Escape');
shift('Ticket');
check(`Esc forgets the anchor: ${selected()}`, selected().join() === 'Ticket');
$('#sel-clear').click();
shift('Loose two');
check(`so does ✕ on the selection bar: ${selected()}`, selected().join() === 'Loose two');
p.key('Escape');

click('Dashboard B', { ctrlKey: true });
click('Loose two', { ctrlKey: true });
p.fire(p.row('Dashboard B'), 'dragstart');
p.fire(p.row('Ticket'), 'dragover', 18);
p.fire(p.row('Ticket'), 'drop', 18);
p.fire(p.row('Dashboard B'), 'dragend');
await wait(200);
check('dragging a selected row moves the whole selection, in drawn order', last().type === 'place' && last().nodes.join() === 't:2,t:6' && last().parent === 'root' && last().order.join().includes('t:3,t:2,t:6'));

$('#sel-close').click();
check(`closing two tabs asks first: «${bar()}»`, last().type === 'place' && $('#selbar').classList.contains('armed') && bar() === 'Close 2 tabs?'
  && !$('#sel-cancel').hidden && $('#sel-folder').hidden && !$('#selbar .timer').hidden);
$('#sel-close').click();
check('the second click closes them', last().type === 'closeItems' && last().tabIds.join() === '2,6' && selected().length === 0);
await wait(200);

click('Its MR', { ctrlKey: true });
click('Loose one', { ctrlKey: true });
$('#sel-folder').click();
await wait(50);
check("→ Folder: a ticket's page stands for its ticket; the folder takes the first row's place",
  last().type === 'newFolder' && last().items.join() === 't:3,t:5' && last().order.includes(`f:${last().id}`) && !last().order.includes('t:3'));

click('Dashboard A', { ctrlKey: true });
click('Dashboard B', { ctrlKey: true });
p.key('Delete');
check('Delete works like Close (asks first)', $('#selbar').classList.contains('armed') && bar() === 'Close 2 tabs?');
done();
