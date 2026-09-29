// Saving the tree and matching it back to restored tabs (probe/snapshot.js).
import { check, done } from './helpers/check.js';
import { snapshotOf, matchTabs, restoredParents, restoredRanks } from '../probe/snapshot.js';

const tab = (id, index, url) => ({ id, index, windowId: 1, url, title: url });

// Before: initiative 1 → epic 2 → task 3 → MR 4; two tabs with one URL (5, 6); 7 on the top level by hand;
// 8 under 9, and 9 will not come back; 10 straight in a folder, with an order of its own.
const before = [
  tab(1, 0, 'https://jira.example.com/browse/PROJ-1'), tab(2, 1, 'https://jira.example.com/browse/PROJ-2'),
  tab(3, 2, 'https://jira.example.com/browse/PROJ-3'), tab(4, 3, 'https://gitlab.example.com/mr/4#note_1'),
  tab(5, 4, 'https://grafana.example.com/d'), tab(6, 5, 'https://grafana.example.com/d'),
  tab(7, 6, 'https://docs.example.com/a'), tab(9, 7, 'https://docs.example.com/parent'),
  tab(8, 8, 'https://docs.example.com/child'), tab(10, 9, 'https://docs.example.com/foldered'),
];
const saved = snapshotOf(before, { 2: 1, 3: 2, 4: 3, 6: 5, 7: -1, 8: 9, 9: 2, 10: 'f:abc' }, { 't:10': 3 });

// After a restart: new ids; the epic redirected to a login page; "parent" gone; one new tab at the end.
const after = [
  tab(101, 0, 'https://jira.example.com/browse/PROJ-1'), tab(102, 1, 'https://sso.example.com/login?next=PROJ-2'),
  tab(103, 2, 'https://jira.example.com/browse/PROJ-3'), tab(104, 3, 'https://gitlab.example.com/mr/4'),
  tab(105, 4, 'https://grafana.example.com/d'), tab(106, 5, 'https://grafana.example.com/d'),
  tab(107, 6, 'https://docs.example.com/a'), tab(108, 7, 'https://docs.example.com/child'),
  tab(111, 8, 'https://docs.example.com/foldered'), tab(110, 9, 'https://new.example.com/'),
];
const match = matchTabs(saved, after);
const p = restoredParents(saved, match);
console.log('restored:', JSON.stringify(p));
check('a chain survives, the redirected epic matched by its place', p[102] === 101 && p[103] === 102 && p[104] === 103);
check('tabs with one URL keep their order', p[106] === 105 && !(105 in p));
check('top level by hand survives', p[107] === -1);
check('a tab whose parent did not come back goes under the nearest ancestor that did', p[108] === 102);
check('folder placement and order survive', p[111] === 'f:abc' && restoredRanks(saved, match)['t:111'] === 3);
check('a new tab is not matched', ![...match.values()].includes(110));
const moved = [after[3], after[0], after[1], after[2], ...after.slice(4)].map((t, i) => ({ ...t, index: i }));
check('a tab that moved is still found by its URL', restoredParents(saved, matchTabs(saved, moved))[104] === 103);
done();
