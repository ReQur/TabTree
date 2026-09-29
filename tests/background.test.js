// probe/background.js on a fake Opera: turning islands into folders, the island mirror, and the panel's
// folder commands.
import { check, wait, done } from './helpers/check.js';
import { makeOpera } from './helpers/opera-fake.js';
import { buildTree } from '../probe/tree.js';

const J = 'https://jira.example.com/browse/';
const G = 'https://gitlab.example.com/group/app/-/merge_requests/';
const o = makeOpera({
  tabs: [
    { id: 10, index: 0, title: 'Team chat', url: 'https://chat.example.com/', pinned: true },
    { id: 1, title: '[PROJ-1] Initiative - Jira', url: J + 'PROJ-1', groupId: 71 },
    { id: 2, title: '[PROJ-2] Epic - Jira', url: J + 'PROJ-2', groupId: 71 },
    { id: 3, title: 'PROJ-2: Epic MR (!5) · Merge requests · group / app · GitLab', url: G + '5', groupId: 71 },
    { id: 4, title: 'Dashboard A', url: 'https://grafana.example.com/a', groupId: 72 },
    { id: 5, title: 'Dashboard B', url: 'https://grafana.example.com/b', groupId: 72 },
    { id: 6, title: 'Loose page', url: 'https://example.com/' },
  ],
  groups: [{ id: 71, title: 'Release', color: 'blue' }, { id: 72, title: '', color: 'pink' }],
  local: { parents: { 2: 1, 3: 2 }, manual: { 4: true } }, // "manual" is a leftover of the island era
});
await import('../probe/background.js');
await wait(1200);

const folderNamed = name => Object.entries(o.local.folders).find(([, f]) => f.name === name)?.[0];
const REL = folderNamed('Release');
const UN = folderNamed('Untitled');
check('islands became top-level folders of the same name and color', REL && UN && o.local.folders[REL].color === 'blue' && o.local.folders[UN].color === 'pink');
check('the top of each island went into its folder', o.local.parents[1] === `f:${REL}` && o.local.parents[4] === `f:${UN}` && o.local.parents[2] === 1);
check('no tab moved', [1, 2, 3].every(id => o.tabs.get(id).groupId === 71) && [4, 5].every(id => o.tabs.get(id).groupId === 72));
check('an unnamed island takes the folder name', o.groups.get(72).title === 'Untitled');
check('island-era leftovers removed', !('manual' in o.local));

await o.ask({ type: 'newFolder', id: 'infra1', name: 'Infra', items: ['t:6'] });
await wait(700);
check('a folder with one tab makes no island (Opera keeps none)', o.tabs.get(6).groupId === -1);
await o.ask({ type: 'place', nodes: ['t:5'], parent: 'f:infra1', order: ['t:6', 't:5'] });
await wait(700);
const infra = o.tabs.get(6).groupId;
check('two tabs: the folder becomes an island with its name', infra !== -1 && o.tabs.get(5).groupId === infra && o.groups.get(infra).title === 'Infra');
check('a folder down to one tab leaves islands', o.tabs.get(4).groupId === -1);
check('the order set by the drop is saved', o.local.ranks['t:6'] === 1 && o.local.ranks['t:5'] === 2);

o.open(20, '[PROJ-4] Task - Jira', J + 'PROJ-4', { openerTabId: 1 });
o.open(21, 'PROJ-2: Another MR (!6) · Merge requests · group / app · GitLab', G + '6', { openerTabId: 10 });
await wait(700);
check('new tabs follow their place in the tree into the island', o.tabs.get(20).groupId === 71 && o.tabs.get(21).groupId === 71);

o.setGroup(3, -1);
await wait(700);
check('a change made to an island in Opera is undone', o.tabs.get(3).groupId === 71);

await o.ask({ type: 'renameFolder', id: REL, name: 'Release 2' });
await o.ask({ type: 'colorFolder', id: REL, color: 'green' });
await wait(700);
check('the island follows the folder name and color', o.groups.get(71).title === 'Release 2' && o.groups.get(71).color === 'green');

await o.ask({ type: 'deleteFolder', id: 'infra1' });
await wait(700);
check('a deleted folder: its tabs go up a level and out of islands', o.local.parents[6] === -1 && o.tabs.get(6).groupId === -1 && o.tabs.get(5).groupId === -1 && !o.local.folders.infra1);

o.close(2);
await wait(700);
const tree = buildTree([...o.tabs.values()].filter(t => !t.pinned), o.local.parents, o.local.folders, o.local.ranks);
check("a closed ticket root: the ticket's next tab takes its place", tree.nodes.get(3).parent === tree.nodes.get(1) && tree.nodes.get(21).parent === tree.nodes.get(3));

await o.chrome.storage.local.set({ settings: { mirrorIslands: false } });
await wait(700);
check('mirror switched off: the islands are released', [...o.tabs.values()].every(t => t.groupId === -1));
done();
