// The panel's menus (probe/panel.js in jsdom): ⋯ and right click on tabs, folders, the selection and the empty
// list; ✕ on a tab row. The checks look at what the panel sends and which tabs it closes, reloads or unloads.
import { check, wait, done } from './helpers/check.js';
import { loadPanel } from './helpers/panel-env.js';

const J = 'https://jira.example.com/browse/';
const G = 'https://gitlab.example.com/group/app/-/merge_requests/';
const tab = (id, title, url, extra = {}) => ({ id, index: id, windowId: 1, title, url, active: false, pinned: false, groupId: -1, favIconUrl: '', lastAccessed: 100, workspaceId: 'w', ...extra });
// Drawn as: Release › Initiative › Epic › (First MR, Fix [flaky] test, First MR again); Loose page › Child page;
// Lone ticket.
let foldersAppear = false;
const p = await loadPanel({
  tabs: [
    tab(1, '[PROJ-1] Initiative - Jira', J + 'PROJ-1'),
    tab(2, '[PROJ-2] Epic - Jira', J + 'PROJ-2'),
    tab(3, 'PROJ-2: First MR (!5) · Merge requests · group / app · GitLab', G + '5'),
    tab(4, 'PROJ-2: Fix [flaky] test (!6) · Merge requests · group / app · GitLab', G + '6'),
    tab(5, 'Loose page', 'https://example.com/loose', { active: true, lastAccessed: 900 }),
    tab(6, 'Child page', 'https://example.com/child'),
    tab(7, '[PROJ-9] Lone ticket - Jira', J + 'PROJ-9'),
    tab(8, 'PROJ-2: First MR (!5) · Merge requests · group / app · GitLab', G + '5'),
  ],
  store: {
    folders: { rel: { name: 'Release', color: 'blue', parent: null, created: 1 } },
    parents: { 1: 'f:rel', 2: 1, 6: 5 },
    ranks: {},
    settings: { onboarded: true },
  },
  // Late in the scenario the background "adds" each new folder, so that it shows up for renaming.
  onMessage: (m, s) => {
    if (!foldersAppear || m.type !== 'newFolder') return null;
    s.folders[m.id] = { name: m.name ?? '', color: 'grey', parent: m.parent ?? null, created: Date.now() };
    return 'folders';
  },
});
const { menu, pick, rightClick, last } = p;
const buttons = text => p.buttons(text).join();

check(`a tab row has ✕ and ⋯ on hover: ${buttons('Child page')}`, buttons('Child page') === 'Close tab,More actions');
check(`a top-level ticket also has → folder: ${buttons('Lone ticket')}`, buttons('Lone ticket') === 'Put PROJ-9 into a new folder,Close tab,More actions');
check(`a folder row has + and ⋯, and no ✕ of its own: ${buttons('Release')}`, buttons('Release') === 'Close 1 duplicate,New folder inside,More actions');
check('the buttons say what they do', p.hoverButton('Child page', 'Close tab').title === 'Close tab (middle click)' && p.hoverButton('Child page', 'More actions').title === 'More actions (right click)');
check('a tab row can be grabbed by its handle, a top-level ticket by the row', !!p.row('Child page').querySelector('.acts .grip') && !p.row('Lone ticket').querySelector('.grip'));
check(`the duplicates button: «${p.hoverButton('Release', 'Close 1 duplicate').textContent}»`, p.hoverButton('Release', 'Close 1 duplicate').textContent === '1 dup');
p.hoverButton('Child page', 'Close tab').click();
check('✕ closes the tab without opening it', p.removed.join() === '6' && !p.activated.includes(6));

p.more('Loose page');
check('the row keeps its buttons while its menu is open', p.row('Loose page').classList.contains('menu-open') && p.hoverButton('Loose page', 'More actions').getAttribute('aria-expanded') === 'true');
check(`⋯ on a tab with a tab under it: ${menu()}`, menu()?.join() === 'Close tab,Close 2 tabs,Put into a new folder,Copy link,Copy links as Markdown,Reload 2 tabs,Unload 2 tabs');
check('hints', p.hint('Close tab') === 'Middle click' && p.hint('Close 2 tabs') === 'This tab and everything under it');
check('separators between the groups', p.$('.menu').querySelectorAll('.msep').length === 3);
pick('Unload 2 tabs');
check('Unload leaves the tab in view alone, and the menu closes', p.discarded.join() === '6' && menu() === null && !p.$('.row.menu-open'));
rightClick('Loose page');
pick('Reload 2 tabs');
check('Reload reloads the whole branch', p.reloaded.join() === '5,6');
rightClick('Loose page');
pick('Close 2 tabs');
check('Close N tabs closes the branch', p.removed.slice(1).join() === '5,6');

const e = rightClick('Child page');
check(`right click opens the same menu instead of the browser's: ${menu()}`, e.defaultPrevented && menu()?.join() === 'Close tab,Put into a new folder,Move to the top level,Copy link,Reload,Unload from memory');
p.key('Escape');
check('Esc closes it', menu() === null);
rightClick('Child page');
p.mousedown(p.$('#stats'));
check('so does a click elsewhere', menu() === null);
rightClick('Child page');
pick('Copy link');
await wait(20);
check('Copy link', p.copied.at(-1) === 'https://example.com/child');

rightClick('Epic');
pick('Move to the top level');
await wait(20);
check(`Move to the top level puts it last there: ${last().order}`, last().type === 'place' && last().nodes.join() === 't:2' && last().parent === 'root' && last().order.join() === 'f:rel,t:5,t:7,t:2');
rightClick('flaky');
pick('Put into a new folder');
await wait(20);
check(`a ticket's page puts the whole ticket into a folder named after it: «${last().name}»`,
  last().type === 'newFolder' && last().items.join() === 't:2' && last().key === 'PROJ-2' && last().name === 'PROJ-2 Epic' && last().color === 'orange');
check('in place of the branch it hangs in, on the nearest level that holds folders', last().parent === 'rel' && last().order.join() === `f:${last().id},t:1`);

p.more('Release');
check(`⋯ on a folder: ${menu()}`, menu()?.join() === 'New folder inside,Rename,Close 1 duplicate,Copy links as Markdown,Delete folder');
const swatches = [...p.$('.menu').querySelectorAll('.sw')];
check('nine colors, the folder’s own one checked', swatches.length === 9 && swatches.filter(b => b.classList.contains('on')).map(b => b.dataset.color).join() === 'blue');
check('Delete folder is the dangerous one and says where the tabs go', p.$('.menu .mi.danger .label')?.textContent === 'Delete folder' && p.hint('Delete folder') === 'Its tabs move one level up');
swatches.find(b => b.dataset.color === 'green').click();
check('a color square recolors the folder', last().type === 'colorFolder' && last().id === 'rel' && last().color === 'green' && menu() === null);
rightClick('Release');
pick('Close 1 duplicate');
check('Close 1 duplicate closes the extra copy', p.removed.at(-1) === 8);
rightClick('Release');
pick('Copy links as Markdown');
await wait(20);
const md = [
  '- **Release**',
  '  - [PROJ-1 Initiative](https://jira.example.com/browse/PROJ-1)',
  '    - [PROJ-2 Epic](https://jira.example.com/browse/PROJ-2)',
  `      - [First MR (!5)](${G}5)`,
  `      - [Fix \\[flaky\\] test (!6)](${G}6)`,
  `      - [First MR (!5)](${G}5)`,
].join('\n');
check(`Copy links as Markdown: the branch as a nested list\n${p.copied.at(-1)}`, p.copied.at(-1) === md);
rightClick('Release');
pick('Rename');
const input = p.$('input.rename');
check('Rename opens the name for editing', input?.closest('.row')?.dataset.folder === 'rel' && input.value === 'Release');
input.dispatchEvent(new p.w.FocusEvent('blur'));
await wait(300);
rightClick('Release');
pick('Delete folder');
check('Delete folder', last().type === 'deleteFolder' && last().id === 'rel');

p.click('Child page', { ctrlKey: true });
p.click('Lone ticket', { ctrlKey: true });
rightClick('Lone ticket');
check(`right click on a selected row: the selection's menu: ${menu()}`, menu()?.join() === 'Put 2 items into a new folder,Move to the top level,Copy links as Markdown,Reload 2 tabs,Unload 2 tabs,Close 2 tabs');
pick('Close 2 tabs');
check('its Close closes the selection without asking again', last().type === 'closeItems' && last().tabIds.join() === '6,7' && p.selected().length === 0);
p.click('Loose page', { ctrlKey: true });
p.click('Initiative', { ctrlKey: true });
rightClick('Epic');
check(`right click outside the selection: that row's menu, and the selection is dropped`, menu()?.[0] === 'Close tab' && p.selected().length === 0
  && p.row('Epic').classList.contains('menu-open'));
p.key('Escape');

foldersAppear = true;
rightClick('Child page');
pick('Put into a new folder');
await wait(400);
check('a tab without a ticket goes into a new folder that opens for renaming', last().type === 'newFolder' && last().items.join() === 't:6' && !last().name && p.$('input.rename')?.closest('.row')?.dataset.folder === last().id);
p.$('input.rename').dispatchEvent(new p.w.FocusEvent('blur'));
await wait(300);
const onList = rightClick(p.$('#list'));
check(`right click on the empty list: ${menu()}`, onList.defaultPrevented && menu()?.join() === 'New folder');
pick('New folder');
await wait(400);
check('which adds a folder on the top level and opens it for renaming', last().type === 'newFolder' && last().parent === null && p.$('input.rename')?.closest('.row')?.dataset.folder === last().id);
p.$('input.rename').dispatchEvent(new p.w.FocusEvent('blur'));
await wait(300);
p.more('Release');
pick('New folder inside');
await wait(20);
check('New folder inside', last().type === 'newFolder' && last().parent === 'rel');
done();
