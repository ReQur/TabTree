// Automatic folders for ticket families, and closing a selection (probe/background.js).
import { check, wait, done } from './helpers/check.js';
import { makeOpera } from './helpers/opera-fake.js';

const J = 'https://jira.example.com/browse/';
const G = 'https://gitlab.example.com/group/app/-/merge_requests/';
const o = makeOpera({
  tabs: [{ id: 10, index: 0, title: 'Team chat', url: 'https://chat.example.com/', pinned: true }],
  local: { folders: {}, parents: {} },
});
await import('../probe/background.js');
await wait(300);
const folderFor = key => Object.entries(o.local.folders).find(([, f]) => f.key === key);

o.open(1, '[PROJ-1] Rate limiter - Jira', J + 'PROJ-1', { openerTabId: 10 });
await wait(700);
check('one tab: no folder yet', !folderFor('PROJ-1'));
o.open(2, 'PROJ-1: Rate limiter (!9) · Merge requests · group / app · GitLab', G + '9', { openerTabId: 10 });
await wait(1200);
const [f1, folder1] = folderFor('PROJ-1') ?? [];
check(`second tab: an automatic folder «${folder1?.name}»`, folder1?.auto && o.local.parents[1] === `f:${f1}`);
check('which is mirrored as an island', o.tabs.get(1).groupId !== -1 && o.tabs.get(1).groupId === o.tabs.get(2).groupId);

// A family under a page without a key (an MR list): its folder goes right after that page.
o.open(3, 'Merge requests · GitLab', 'https://gitlab.example.com/dashboard/merge_requests');
o.open(4, 'PROJ-2: Ledger (!30) · Merge requests · group / app · GitLab', G + '30', { openerTabId: 3 });
await wait(700);
check('one tab under a hub: no folder', !folderFor('PROJ-2'));
o.open(5, '[PROJ-2] Ledger - Jira', J + 'PROJ-2', { openerTabId: 4 });
await wait(1200);
const [f2] = folderFor('PROJ-2') ?? [];
const top = Object.entries(o.local.ranks).filter(([k]) => ['t:3', `f:${f2}`, `f:${f1}`].includes(k)).sort((a, b) => a[1] - b[1]).map(([k]) => k);
check('the family leaves the hub for a folder right after it', f2 && top.indexOf(`f:${f2}`) === top.indexOf('t:3') + 1);

await o.ask({ type: 'deleteFolder', id: f1 });
await wait(1200);
check('a deleted family folder is not made again', !folderFor('PROJ-1') && o.local.declined?.['PROJ-1'] === true);

await o.ask({ type: 'place', nodes: ['t:5'], parent: 'root', order: [] });
await wait(1200);
check('a family taken out of its folder: no folder again, the empty automatic folder goes', !folderFor('PROJ-2') && !o.local.folders[f2] && o.local.declined?.['PROJ-2'] === true);

await o.chrome.storage.local.set({ settings: { autoFolders: false } });
o.open(6, '[PROJ-3] Third - Jira', J + 'PROJ-3', { openerTabId: 10 });
o.open(7, 'PROJ-3: Third (!11) · Merge requests · group / app · GitLab', G + '11', { openerTabId: 10 });
await wait(1200);
check('switched off: no automatic folders', !folderFor('PROJ-3'));

await o.ask({ type: 'newFolder', id: 'sel1', name: 'Selection', items: ['t:6', 't:7'] });
await wait(700);
await o.ask({ type: 'closeItems', tabIds: [6, 7], folderIds: ['sel1'] });
await wait(700);
check('closing a selection closes its tabs and removes its folders', !o.tabs.has(6) && !o.tabs.has(7) && !o.local.folders.sel1 && !o.local.declined?.['PROJ-3']);
done();
