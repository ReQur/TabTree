// probe/background.js on a fake Chrome (Edge is the same): the toolbar button opens the side panel, tabs have no
// workspaces, folders are mirrored as tab groups, and a tab the panel opens keeps the opener it was given.
import { check, wait, done } from './helpers/check.js';
import { makeChrome } from './helpers/opera-fake.js';

const J = 'https://jira.example.com/browse/';
const MR = 'https://gitlab.example.com/group/app/-/merge_requests/42';
const PIPELINE = 'https://gitlab.example.com/group/app/-/pipelines/6';
const c = makeChrome({
  tabs: [
    { id: 1, title: '[PROJ-1] Task - Jira', url: J + 'PROJ-1', active: true },
    { id: 2, title: 'Dashboard', url: 'https://grafana.example.com/a' },
  ],
  local: { folders: {} },
});
await import('../probe/background.js');
await wait(300);
check('the toolbar button opens the side panel', c.panel.behavior?.openPanelOnActionClick === true);

c.open(3, 'PROJ-1: Fix (!42) · Merge requests · group / app · GitLab', MR, { openerTabId: 1 });
await wait(1500);
const [id] = Object.keys(c.local.folders);
const gid = c.tabs.get(1).groupId;
check('a ticket and its merge request get a folder, and the folder a tab group of its name',
  c.local.folders[id]?.auto && gid !== -1 && c.tabs.get(3).groupId === gid && c.groups.get(gid).title === c.local.folders[id].name);
check(`the group is recorded without a workspace: ${Object.keys(c.session.mirror)}`, c.session.mirror[`${id}|1|`] === gid);
check('the other tab stays out of groups', c.tabs.get(2).groupId === -1);

const reply = await c.ask({ type: 'openTab', url: PIPELINE, parent: 3 });
await wait(800);
const made = [...c.tabs.values()].find(t => t.pendingUrl === PIPELINE);
check(`a tab the panel opens has the opener it was given (#${made?.openerTabId}), and hangs there, in the group`,
  reply.ok && made.openerTabId === 3 && c.local.parents[made.id] === 3 && made.groupId === gid);
done();
