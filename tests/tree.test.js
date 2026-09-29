// Building the tree (probe/tree.js): folders, placements, tickets, order, cycles.
import { check, done } from './helpers/check.js';
import { buildTree } from '../probe/tree.js';

const J = 'https://jira.example.com/browse/';
const G = 'https://gitlab.example.com/group/app/-/merge_requests/';
const t = (id, index, title, url) => ({ id, index, title, url });
const tabs = [
  t(1, 0, '[PROJ-1] Initiative - Jira', J + 'PROJ-1'),
  t(2, 1, '[PROJ-2] Epic - Jira', J + 'PROJ-2'),
  t(3, 2, 'PROJ-2: Epic MR (!5) · Merge requests · group / app · GitLab', G + '5'),
  t(4, 3, 'Dashboard A', 'https://grafana.example.com/a'),
  t(5, 4, 'Dashboard B', 'https://grafana.example.com/b'),
  t(6, 5, 'Loose page', 'https://example.com/'),
  t(7, 6, '[PROJ-3] Task - Jira', J + 'PROJ-3'),
  t(8, 7, 'Cycle a', 'https://example.com/a'),
  t(9, 8, 'Cycle b', 'https://example.com/b'),
];
const folders = {
  rel: { name: 'Release', color: 'blue', parent: null, created: 1 },
  dash: { name: 'Dashboards', color: 'pink', parent: 'rel', created: 2 },
  l1: { name: 'Loop A', color: 'grey', parent: 'l2', created: 3 },
  l2: { name: 'Loop B', color: 'grey', parent: 'l1', created: 4 },
};
// Tab 3 (the epic's MR) was placed in Dashboards by hand; as a page of PROJ-2 it still hangs under the epic.
const parents = { 1: 'f:rel', 2: 1, 3: 'f:dash', 4: 'f:dash', 5: 'f:dash', 7: 2, 8: 9, 9: 8 };
const ranks = { 't:5': 1, 't:4': 2 };

const { root, nodes } = buildTree(tabs, parents, folders, ranks);
const draw = n => (n.folder ? `[${n.folder.name}]` : n.ticket ? n.ticket.key : `#${n.tab.id}`);
const show = (n, d = 0) => [`${'  '.repeat(d)}${draw(n)}`, ...n.children.flatMap(c => show(c, d + 1))];
console.log(root.children.flatMap(n => show(n)).join('\n'));

const rel = root.children.find(n => n.folder?.id === 'rel');
check('a folder nests in a folder, folders first', rel.children[0].folder?.id === 'dash');
const dash = nodes.get(5).parent;
check('order set by hand wins (B before A)', dash.folder?.id === 'dash' && dash.children.indexOf(nodes.get(5)) < dash.children.indexOf(nodes.get(4)));
check('initiative → epic → task', nodes.get(2).parent === nodes.get(1) && nodes.get(7).parent === nodes.get(2));
check('a ticket page stays under its ticket, and comes first', nodes.get(3).parent === nodes.get(2) && nodes.get(2).children[0] === nodes.get(3));
check('a folder cycle is broken without losing a folder', root.children.find(n => n.folder?.id === 'l1')?.children[0].folder?.id === 'l2');
check('a tab cycle is broken without losing a tab', [8, 9].every(id => nodes.get(id).parent) && [8, 9].some(id => nodes.get(id).parent.root));

const { nodes: n2 } = buildTree(tabs, { ...parents, 2: undefined }, folders, ranks);
check('a ticket without a place of its own goes where another of its tabs was placed', n2.get(2).parent.folder?.id === 'dash' && n2.get(3).parent === n2.get(2));
const { nodes: n3 } = buildTree(tabs, { ...parents, 7: -1 }, folders, ranks);
check('-1 puts a tab on the top level', n3.get(7).parent.root === true);
done();
