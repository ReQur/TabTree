// An empty workspace (probe/panel.js in jsdom): the empty state with its New folder button, and the other
// workspaces still listed under it.
import { check, wait, done } from './helpers/check.js';
import { loadPanel } from './helpers/panel-env.js';

const tab = (id, title, url, extra = {}) => ({ id, index: id, windowId: 1, title, url, active: false, pinned: false, groupId: -1, favIconUrl: '', lastAccessed: 100, workspaceId: 'w', workspaceName: 'Main', ...extra });
const p = await loadPanel({
  tabs: [
    tab(1, 'Start', 'https://start.example.com/', { pinned: true, active: true, lastAccessed: 900 }),
    tab(2, 'Recipes', 'https://recipes.example.com/', { workspaceId: 'p', workspaceName: 'Personal' }),
  ],
  store: { folders: {}, parents: {}, ranks: {}, settings: { onboarded: true } },
});
const { $ } = p;

check(`no tabs in the tree: «${$('#list .empty h4')?.textContent}»`, $('#list .empty h4')?.textContent === 'No tabs in this workspace' && !!$('#list .empty p'));
check('the other workspaces are still there', $('#list .section')?.textContent === 'Other workspaces' && p.rows().length === 1);
check(`the status bar: «${$('#stats').textContent}», no islands`, $('#stats').textContent === '1 tab · 0 folders · 0 tickets · +1 in Personal' && $('#islands').hidden);
[...p.w.document.querySelectorAll('#list .empty button')].find(b => b.textContent === 'New folder').click();
await wait(20);
check('New folder makes one on the top level', p.last()?.type === 'newFolder' && p.last().parent === null);
done();
