// A browser restart: the tree is saved as it changes, survives the shutdown, and comes back on new tab ids
// (probe/background.js with probe/snapshot.js). Both sessions share one storage.local.
import { check, wait, done } from './helpers/check.js';
import { makeOpera } from './helpers/opera-fake.js';

const J = 'https://jira.example.com/browse/';
const local = {
  folders: { rel: { name: 'Release', color: 'blue', parent: null, created: 1 }, dash: { name: 'Dashboards', color: 'pink', parent: 'rel', created: 2 } },
  parents: { 4: 'f:dash', 5: 'f:dash' },
  ranks: { 't:5': 1, 't:4': 2, 'f:dash': 1 },
};

// Session 1: an island for "Release"; an initiative opened from nowhere, an epic and a task opened from it.
const s1 = makeOpera({
  tabs: [
    { id: 4, title: 'Dashboard A', url: 'https://grafana.example.com/a', groupId: 71 },
    { id: 5, title: 'Dashboard B', url: 'https://grafana.example.com/b', groupId: 71 },
  ],
  groups: [{ id: 71, title: 'Release', color: 'blue' }],
  local,
  session: { sid: 1, mirror: { 'rel|1|w': 71 } },
});
await import('../probe/background.js?session=1');
s1.open(1, '[PROJ-1] Initiative - Jira', J + 'PROJ-1');
s1.open(2, '[PROJ-2] Epic - Jira', J + 'PROJ-2', { openerTabId: 1 });
s1.open(3, '[PROJ-3] Task - Jira', J + 'PROJ-3', { openerTabId: 2 });
await wait(1600);
check('the snapshot keeps links, folder places and order', local.snapshot?.tabs.some(s => s.parent === 'f:dash' && s.rank === 1) && local.snapshot.tabs.filter(s => typeof s.parent === 'number').length === 2);

// Shutdown: the window closes with its tabs; the snapshot must not change.
const savedAt = local.snapshot.savedAt;
for (const id of [...s1.tabs.keys()]) {
  s1.tabs.delete(id);
  s1.listeners.removed(id, { windowId: 1, isWindowClosing: true });
}
await wait(1500);
check('a closing window leaves the snapshot alone', local.snapshot.savedAt === savedAt);

// Session 2: new ids, the island restored by Opera under a new id, the epic redirected to a login page.
const s2 = makeOpera({
  tabs: [
    { id: 104, index: 0, title: 'Dashboard A', url: 'https://grafana.example.com/a', groupId: 900 },
    { id: 105, index: 1, title: 'Dashboard B', url: 'https://grafana.example.com/b', groupId: 900 },
    { id: 101, index: 2, title: '[PROJ-1] Initiative - Jira', url: J + 'PROJ-1' },
    { id: 102, index: 3, title: 'Sign in', url: 'https://sso.example.com/login?next=PROJ-2' },
    { id: 103, index: 4, title: '[PROJ-3] Task - Jira', url: J + 'PROJ-3' },
  ],
  groups: [{ id: 900, title: 'Release', color: 'blue' }],
  local,
  session: {}, // emptied by the restart
});
await import('../probe/background.js?session=2');
await wait(300);
check('nothing is saved before the old snapshot is read', local.snapshot.savedAt === savedAt);
await wait(3500);
check('links come back on the new ids (the redirected epic by its place)', local.parents[102] === 101 && local.parents[103] === 102);
check('folder places and order come back', local.parents[104] === 'f:dash' && local.parents[105] === 'f:dash' && local.ranks['t:105'] === 1 && local.ranks['t:104'] === 2 && local.ranks['f:dash'] === 1);
check('the restored island is adopted, nothing moves', [104, 105].every(id => s2.tabs.get(id).groupId === 900) && s2.session.mirror['rel|1|w'] === 900);
check('a new snapshot is saved for the new session', local.snapshot.savedAt > savedAt);
done();
