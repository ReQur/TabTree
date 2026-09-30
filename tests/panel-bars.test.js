// The bars around the tree (probe/panel.js in jsdom): the status bar with its island squares, the pinned row,
// the other workspaces, toasts, the search field's clear button, and the selection bar's armed Close with
// Cancel and its timeout.
import { check, wait, done } from './helpers/check.js';
import { loadPanel } from './helpers/panel-env.js';

const J = 'https://jira.example.com/browse/';
const tab = (id, title, url, extra = {}) => ({ id, index: id, windowId: 1, title, url, active: false, pinned: false, groupId: -1, favIconUrl: '', lastAccessed: 100, workspaceId: 'w', ...extra });
const p = await loadPanel({
  tabs: [
    tab(1, 'Team chat', 'https://chat.example.com/', { pinned: true, audible: true, active: true, lastAccessed: 900 }),
    tab(2, 'Mail', 'https://mail.example.com/', { pinned: true }),
    tab(3, '[PROJ-1] Release train - Jira', J + 'PROJ-1'),
    tab(4, 'Checkout latency', 'https://grafana.example.com/a'),
    tab(5, 'nightly-build [Jenkins]', 'https://ci.example.com/job/nightly/128/'),
    tab(6, 'Node exporter', 'https://grafana.example.com/n'),
    tab(7, 'Online bank', 'https://bank.example.com/', { discarded: true }),
    tab(8, 'Inbox', 'https://mail.example.com/inbox'),
    tab(9, 'A message', 'https://mail.example.com/1'),
    tab(10, 'Another message', 'https://mail.example.com/2'),
    tab(11, 'Recipes', 'https://recipes.example.com/', { workspaceId: 'p', workspaceName: 'Personal' }),
    tab(12, 'Retro notes', 'https://notes.example.com/', { workspaceId: 'p', workspaceName: 'Personal' }),
  ],
  store: {
    folders: {
      rel: { name: 'Release 2.4', color: 'blue', parent: null, created: 1 },
      infra: { name: 'Infra', color: 'green', parent: null, created: 2 },
      solo: { name: 'Personal', color: 'grey', parent: null, created: 3 },
    },
    parents: { 3: 'f:rel', 4: 'f:rel', 5: 'f:infra', 6: 'f:infra', 7: 'f:solo', 9: 8, 10: 8 },
    ranks: {},
    settings: { onboarded: true },
  },
});
const { $, click, selected, sent } = p;
const all = sel => [...p.w.document.querySelectorAll(sel)];

check(`the status bar counts: «${$('#stats').textContent}»`, $('#stats').textContent === '10 tabs · 3 folders · 1 ticket · +2 in Personal');
const squares = () => all('#islands .sq').map(s => s.className.replace('sq c-', ''));
check(`a square for each island, in its color: ${squares()}`, $('#islands').textContent === 'Islands' && squares().join() === 'blue,green' && !$('#islands').hidden);
check('Personal, one tab, is no island: no rail, no square', !p.row('Personal').classList.contains('isl') && p.row('Online bank').classList.contains('discarded'));
check('the pinned row: a tile per pinned tab, the active one marked, a dot on the one playing sound',
  all('#pinned .pin').length === 2 && all('#pinned .pin.on').length === 1 && !!$('#pinned .pin.on .snd') && !$('#pinned').hidden);
const group = p.rows().find(r => r.classList.contains('group'));
check(`the other workspaces sit under a section of their own, folded: «${group?.textContent}»`,
  $('#list .section')?.textContent === 'Other workspaces' && group?.querySelector('.title').textContent === 'Personal' && group.querySelector('.count').textContent === '2' && !p.row('Recipes'));
p.row('Inbox').querySelector('.twisty').click();
check(`a folded row counts what it hides: «${p.row('Inbox').querySelector('.count')?.textContent}»`, p.row('Inbox').querySelector('.count')?.textContent === '+2' && !p.row('A message'));
$('#islands').click();
check('a click on Islands opens Settings', p.w.document.body.dataset.view === 'settings');
p.key('Escape');

// An error: a toast that stays a while, with the report at hand.
const send = globalThis.chrome.runtime.sendMessage;
globalThis.chrome.runtime.sendMessage = async () => undefined;
p.row('Infra').querySelector('.dot').click();
await wait(20);
globalThis.chrome.runtime.sendMessage = send;
const toast = () => $('#toasts .toast');
check(`a failed command shows an error toast: «${toast()?.textContent}»`, toast()?.classList.contains('err') && toast().querySelector('.grow').textContent === 'colorFolder failed: no answer'
  && [...toast().querySelectorAll('button')].map(b => b.textContent).join() === 'Copy report');

// Armed Close: the question, Close and Cancel, and it gives up after 4 seconds.
const armed = () => $('#selbar').classList.contains('armed');
click('Checkout latency', { ctrlKey: true });
click('Node exporter', { ctrlKey: true });
$('#sel-close').click();
check(`Close asks first: «${$('#sel-what').textContent}»`, armed() && $('#sel-what').textContent === 'Close 2 tabs?' && $('#selbar').getAttribute('role') === 'alertdialog');
$('#sel-cancel').click();
check('Cancel keeps the tabs and the selection', !armed() && selected().join() === 'Checkout latency,Node exporter' && !sent.some(m => m.type === 'closeItems') && $('#sel-what').textContent === '2 tabs');
$('#sel-close').click();
p.key('Escape');
check('so does Esc', !armed() && selected().length === 2);
$('#sel-close').click();
await wait(4100);
check('after 4 seconds Close is plain again', !armed() && selected().length === 2 && !sent.some(m => m.type === 'closeItems'));
check('the error toast is still there', toast()?.classList.contains('err'));
toast().querySelector('button').click();
await wait(50);
check(`its Copy report copies the report and says so: «${toast()?.textContent}»`, p.copied.at(-1)?.startsWith('## Branchy report') && toast()?.textContent === 'Report copied' && !toast().classList.contains('err'));
p.key('Escape');
check('and Esc then clears the selection', selected().length === 0 && $('#selbar').hidden);

// The search field's clear button.
check('the clear button shows only while the field holds text', $('#q-clear').hidden);
p.search('inbox');
check('typing shows it, in place of the / hint', !$('#q-clear').hidden && $('.search .k').hidden && all('#list .row.hit').length === 1);
$('#q-clear').click();
check('a click clears the search and shows the tree again', $('#q').value === '' && $('#q-clear').hidden && !$('.search .k').hidden && !!p.row('Release 2.4') && p.w.document.activeElement === $('#q'));

await globalThis.chrome.storage.local.set({ settings: { onboarded: true, mirrorIslands: false } });
await wait(200);
check(`islands off: «${$('#islands').textContent}», no rails`, $('#islands').textContent === 'Islands off' && !all('#list .row.isl').length);
await wait(2500);
check('a confirmation goes away after 2.5 seconds', !toast());
done();
