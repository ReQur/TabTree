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
const view = name => $(`#views button[data-view="${name}"]`).click();
const flip = id => {
  $(id).checked = !$(id).checked;
  $(id).dispatchEvent(new p.w.Event('change'));
};

check(`a first start shows the setup guide above the tree: ${texts('#list .card h4')}`, texts('#list .card h4').join() === 'Set up TabTree' && $('#list').firstElementChild === $('.card'));
check(`three steps: ${texts('.steps li b')}`, texts('.steps li b').join('|') === "Pin this panel|Collapse Opera's tabs|Turn off automatic Tab Islands" && texts('.steps .num').join() === '1,2,3');
check('the tree is still there under it', !!p.row('Dashboard A'));
$('.steps li[data-step="tabs"]').click();
await wait(300);
check('a step is ticked by hand and stays ticked', store.settings?.setup?.tabs === true && $('.steps li[data-step="tabs"]').classList.contains('done') && texts('.steps .num').join() === '1,✓,3');
$('.steps li[data-step="tabs"]').click();
await wait(300);
check('and unticked', store.settings.setup.tabs === false && texts('.steps .num').join() === '1,2,3');
$('.steps li[data-step="pin"]').click();
$('.steps li[data-step="islands"]').click();
await wait(300);
check('two quick clicks tick both steps', store.settings.setup.pin === true && store.settings.setup.islands === true && texts('.steps .num').join() === '✓,2,✓');
[...all('.card button')].find(b => b.textContent === 'Later').click();
check('"Later" hides the guide without remembering it', !$('.card') && store.settings.onboarded === undefined);

view('settings');
check(`Settings: ${texts('.settings h3')}`, texts('.settings h3').join() === 'Tree,Opera,Diagnostics,Setup' && $('#views button.on')?.dataset.view === 'settings' && !$('.card'));
check('both switches are on by default', $('#set-auto-folders').checked && $('#set-mirror').checked);
check(`tickets kept out of automatic folders, sorted: ${texts('.chip')}`, texts('.chips .muted').join() === 'Never for' && all('.chip').map(c => c.dataset.key).join() === 'ABC-1,PROJ-77');
const allow = $('.chip[data-key="PROJ-77"] button');
check('each with ✕ to allow it again', allow.title === 'Allow a folder for PROJ-77');
allow.click();
await wait(300);
check('✕ sends allowAutoFolder, and the chip goes', p.last().type === 'allowAutoFolder' && p.last().key === 'PROJ-77' && all('.chip').map(c => c.dataset.key).join() === 'ABC-1');
const islands = () => all('.islands li').map(li => `${li.querySelector('.title').textContent}: ${li.querySelector('.count').textContent}`);
check(`the islands of the top-level folders: ${islands().join('; ')}`, islands().join('; ') === 'Release: 2 tabs · island; Solo: 1 tab · no island, Opera needs 2; Empty: 0 tabs · no island');
flip('#set-auto-folders');
await wait(300);
check('Auto-folders off, without losing the other settings', store.settings.autoFolders === false && store.settings.setup.tabs === false && !$('#set-auto-folders').checked);
flip('#set-mirror');
await wait(300);
check(`Islands off: ${islands()[0]}`, store.settings.mirrorIslands === false && islands()[0] === 'Release: 2 tabs · islands are off');
$('.chip[data-key="ABC-1"] button').click();
await wait(300);
check('with none left: says so', !$('.chip') && texts('.chips .muted').join() === 'No ticket is kept out of automatic folders.');

const option = name => all('.opt').find(o => o.querySelector('b').textContent === name);
option('Report').querySelector('button').click();
await wait(50);
check('Report › Copy copies the report', p.copied.at(-1)?.startsWith('## TabTrees probe'));
option('Log').querySelector('button').click();
await wait(50);
check('Log › Open opens the log', $('#views button.on')?.dataset.view === 'log' && !!$('pre.log'));
view('settings');
p.key('Escape');
check('Esc goes back to the tree', $('#views button.on')?.dataset.view === 'tree' && !!p.row('Dashboard A'));
view('settings');
option('Setup guide').querySelector('button').click();
check('Setup guide › Show brings the guide back, above the tree', $('#views button.on')?.dataset.view === 'tree' && !!$('#list .card'));
await wait(300);
check('and forgets that it was dismissed', store.settings.onboarded === false);
[...all('.card button')].find(b => b.textContent === 'Got it').click();
await wait(300);
check('"Got it" hides it for good', store.settings.onboarded === true && !$('.card'));
done();
