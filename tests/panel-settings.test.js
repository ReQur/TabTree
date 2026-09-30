// The setup guide and the Settings view (probe/panel.js in jsdom): steps ticked by hand, "Got it" and "Later",
// the switches, the tickets kept out of automatic folders, the island state of each top-level folder.
import { check, wait, done } from './helpers/check.js';
import { loadPanel } from './helpers/panel-env.js';

const tab = (id, title, url, extra = {}) => ({ id, index: id, windowId: 1, title, url, active: false, pinned: false, groupId: -1, favIconUrl: '', lastAccessed: 100, workspaceId: 'w', ...extra });
const p = await loadPanel({
  tabs: [
    tab(1, 'Dashboard A', 'https://grafana.example.com/a'),
    tab(2, 'Dashboard B', 'https://grafana.example.com/b'),
    tab(3, 'Runbook', 'https://wiki.example.com/runbook'),
    tab(4, 'Loose', 'https://example.com/', { active: true, lastAccessed: 900 }),
  ],
  store: {
    folders: {
      rel: { name: 'Release', color: 'blue', parent: null, created: 1 },
      solo: { name: 'Solo', color: 'green', parent: null, created: 2 },
      empty: { name: 'Empty', color: 'grey', parent: null, created: 3 },
      sub: { name: 'Nested', color: 'red', parent: 'rel', created: 4 },
    },
    parents: { 1: 'f:rel', 2: 'f:sub', 3: 'f:solo' },
    ranks: {},
    declined: { 'PROJ-77': true, 'ABC-1': true },
    log: [
      { t: 1000, ev: 'created', id: 4, index: 4, opener: 3, openerHost: 'wiki.example.com', groupId: -1, host: 'example.com' },
      { t: 2000, ev: 'place', node: 't:4', parent: 'f:rel' },
      { t: 3000, ev: 'mirror', islands: 1, moved: 1, ungrouped: 0 },
    ],
    changes: [{ t: 2500, ev: 'title', id: 2, host: 'grafana.example.com' }],
  },
  // What the background does with allowAutoFolder.
  onMessage: (m, s) => {
    if (m.type !== 'allowAutoFolder') return null;
    delete s.declined[m.key];
    return 'declined';
  },
});
const { $, store } = p;
const all = sel => [...p.w.document.querySelectorAll(sel)];
const texts = sel => all(sel).map(e => e.textContent);
const view = name => $({ settings: '#open-settings', log: '#open-log', tree: '#back' }[name]).click();
const shown = () => p.w.document.body.dataset.view;
// A ticked step shows a tick instead of its number.
const nums = () => all('.steps .num').map(n => (n.querySelector('svg') ? '✓' : n.textContent)).join();
const flip = id => {
  $(id).checked = !$(id).checked;
  $(id).dispatchEvent(new p.w.Event('change'));
};

check(`a first start shows the setup guide above the tree: ${texts('#list .card h4')}`, texts('#list .card h4').join() === 'Set up Branchy' && $('#list').firstElementChild === $('.card'));
check(`three steps: ${texts('.steps li b')}`, texts('.steps li b').join('|') === "Pin this panel|Collapse Opera's tabs|Turn off automatic Tab Islands" && nums() === '1,2,3');
check('the tree is still there under it', !!p.row('Dashboard A'));
$('.steps li[data-step="tabs"]').click();
await wait(300);
check('a step is ticked by hand and stays ticked', store.settings?.setup?.tabs === true && $('.steps li[data-step="tabs"]').classList.contains('done') && nums() === '1,✓,3');
$('.steps li[data-step="tabs"]').click();
await wait(300);
check('and unticked', store.settings.setup.tabs === false && nums() === '1,2,3');
$('.steps li[data-step="pin"]').click();
$('.steps li[data-step="islands"]').click();
await wait(300);
check('two quick clicks tick both steps', store.settings.setup.pin === true && store.settings.setup.islands === true && nums() === '✓,2,✓');
[...all('.card button')].find(b => b.textContent === 'Later').click();
check('"Later" hides the guide without remembering it', !$('.card') && store.settings.onboarded === undefined);

view('settings');
check(`Settings: ${texts('.settings .sub')}`, texts('.settings .sub').join() === 'Background,Text,Statuses,Tree,Opera,Backup,Diagnostics,Setup' && shown() === 'settings' && !$('.card') && $('#hdr').hidden && $('#view-title').textContent === 'Settings');
check('both switches are on by default', $('#set-auto-folders').checked && $('#set-mirror').checked);
check(`tickets kept out of automatic folders, sorted: ${texts('.chip')}`, texts('.chips .muted').join() === 'Never for' && all('.chip').map(c => c.dataset.key).join() === 'ABC-1,PROJ-77');
const allow = $('.chip[data-key="PROJ-77"] button');
check('each with ✕ to allow it again', allow.title === 'Allow a folder for PROJ-77');
allow.click();
await wait(300);
check('✕ sends allowAutoFolder, and the chip goes', p.last().type === 'allowAutoFolder' && p.last().key === 'PROJ-77' && all('.chip').map(c => c.dataset.key).join() === 'ABC-1');
const islands = () => all('.islands .il').map(li => `${li.querySelector('.grow').textContent}: ${li.querySelector('.m').textContent}`);
check(`the islands of the top-level folders: ${islands().join('; ')}`, islands().join('; ') === 'Release: 2 tabs · island; Solo: 1 tab · no island, Opera needs 2; Empty: 0 tabs · no island');
flip('#set-auto-folders');
await wait(300);
check('Auto-folders off, without losing the other settings', store.settings.autoFolders === false && store.settings.setup.tabs === false && !$('#set-auto-folders').checked);
const sizes = () => [...p.w.document.querySelectorAll('.seg[aria-label="Text size"] button')];
check(`text size: ${sizes().map(b => b.textContent)}, 12 at first`, sizes().map(b => b.textContent).join() === '10,11,12,13,14,15'
  && sizes().find(b => b.classList.contains('on'))?.dataset.size === '12' && !p.w.document.body.style.getPropertyValue('--ui-zoom'));
sizes().find(b => b.dataset.size === '14').click();
await wait(300);
check(`a size draws the whole panel at it, from 12px: zoom ${p.w.document.body.style.getPropertyValue('--ui-zoom')}`,
  store.settings.textSize === 14 && Math.abs(parseFloat(p.w.document.body.style.getPropertyValue('--ui-zoom')) - 14 / 12) < 1e-9
  && sizes().find(b => b.classList.contains('on'))?.dataset.size === '14');
sizes().find(b => b.dataset.size === '12').click();
await wait(300);
check('back at 12: no zoom', store.settings.textSize === 12 && !p.w.document.body.style.getPropertyValue('--ui-zoom'));
check('links from other apps go to their open tab, unless switched off', $('#set-reuse-tabs').checked);
flip('#set-reuse-tabs');
await wait(300);
check('switched off', store.settings.reuseTabs === false && !$('#set-reuse-tabs').checked);
flip('#set-mirror');
await wait(300);
check(`Islands off: ${islands()[0]}`, store.settings.mirrorIslands === false && islands()[0] === 'Release: 2 tabs · islands are off');
$('.chip[data-key="ABC-1"] button').click();
await wait(300);
check('with none left: says so', !$('.chip') && texts('.chips .muted').join() === 'No ticket is kept out of automatic folders.');

const option = name => all('.opt').find(o => o.querySelector('b').textContent === name);
option('Report').querySelector('button').click();
await wait(50);
check('Report › Copy copies the report', p.copied.at(-1)?.startsWith('## Branchy report'));
option('Log').querySelector('button').click();
await wait(50);
check('Log › Open opens the log', shown() === 'log' && !!$('.logv .kv') && !$('#report').hidden && $('#view-title').textContent === 'Log');
check(`the Log view sums the report up: ${texts('.kv dt')}`, texts('.kv dt').join() === 'Opera,APIs,Tabs,Workspaces,Folders,Placements,Snapshot,Statuses');
const events = () => all('.ev').map(e => `${e.querySelector('.t').textContent}: ${e.querySelector('p').textContent}`);
check(`then the events, newest first, tagged by kind: ${events().join(' / ')}`,
  events().join(' / ') === 'mirror: 1 island, 1 tab moved in, 0 taken out / place: t:4 under f:rel / created: #4 from #3 wiki.example.com → example.com'
  && $('.ev .t').classList.contains('c-cyan'));
[...all('.seg button')].find(b => b.textContent.startsWith('Background changes')).click();
await wait(50);
check(`Background changes: ${events()}`, events().join() === 'title: #2 grafana.example.com' && $('.seg button.on').textContent === 'Background changes1');
const clipboard = p.w.navigator.clipboard.writeText;
p.w.navigator.clipboard.writeText = async () => {
  throw new Error('denied');
};
$('#report').click();
await wait(50);
p.w.navigator.clipboard.writeText = clipboard;
check(`when the clipboard refuses, the report is shown selected: «${$('.banner')?.textContent}»`,
  $('.banner')?.textContent === 'The clipboard refused. The report is selected: press Ctrl+C, then Esc.' && $('textarea.report')?.value.startsWith('## Branchy report'));
view('settings');
p.key('Escape');
check('Esc goes back to the tree', shown() === 'tree' && !!p.row('Dashboard A') && !$('#hdr').hidden && $('#vbar').hidden);
view('settings');
option('Setup guide').querySelector('button').click();
check('Setup guide › Show brings the guide back, above the tree', shown() === 'tree' && !!$('#list .card'));
await wait(300);
check('and forgets that it was dismissed', store.settings.onboarded === false);
[...all('.card button')].find(b => b.textContent === 'Got it').click();
await wait(300);
check('"Got it" hides it for good', store.settings.onboarded === true && !$('.card'));
done();
