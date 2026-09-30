// Backups (probe/backup.js, and importTree in probe/background.js on a fake Opera): what Export writes, what Import
// takes from a file of any shape, and an import into a copy of the extension installed afresh, which turned the
// islands left by the old copy into folders of its own at start.
import { check, wait, done } from './helpers/check.js';
import { makeOpera } from './helpers/opera-fake.js';
import { backupOf, readBackup } from '../probe/backup.js';
import { restoredParents } from '../probe/snapshot.js';

const J = 'https://jira.example.com/browse/';
const tabs = [
  { id: 1, windowId: 1, index: 0, title: '[PROJ-1] Initiative - Jira', url: J + 'PROJ-1', groupId: 71 },
  { id: 2, windowId: 1, index: 1, title: '[PROJ-2] Epic - Jira', url: J + 'PROJ-2', groupId: 71 },
  { id: 3, windowId: 1, index: 2, title: 'Dashboard', url: 'https://grafana.example.com/a', groupId: 71 },
  { id: 4, windowId: 1, index: 3, title: 'Loose', url: 'https://example.com/' },
  { id: 5, windowId: 1, index: 4, title: 'Private', url: 'https://private.example.com/', incognito: true },
];
const stored = {
  folders: {
    rel: { name: 'Release', color: 'blue', parent: null, created: 1 },
    sub: { name: 'Dashboards', color: 'pink', parent: 'rel', created: 2 },
  },
  parents: { 1: 'f:rel', 2: 1, 3: 'f:sub', 4: -1 },
  ranks: { 'f:sub': 2, 't:1': 1, 't:3': 1 },
  settings: { autoFolders: false, onboarded: true, setup: { pin: true } },
  declined: { 'PROJ-9': true },
  wallpaper: {
    source: 'file', name: 'sea.jpg', dataUrl: 'data:image/jpeg;base64,AAAA', width: 10, height: 10, w: 10, h: 10, bytes: 3,
    tones: { vivid: null, dark: [0, 0, 0], mean: [9, 9, 9] }, x: 50, dim: 70, blur: 0, accent: 'wallpaper',
  },
};

const backup = backupOf({ tabs, ...stored }, 1000);
check('a backup says what it is', backup.tabtree === 1 && backup.savedAt === 1000);
check(`the folders and their order; the tabs' order goes with the tabs: ${JSON.stringify(backup.ranks)}`,
  JSON.stringify(backup.folders) === JSON.stringify(stored.folders) && JSON.stringify(backup.ranks) === '{"f:sub":2}');
check(`the switches, without the setup guide's ticks: ${JSON.stringify(backup.settings)}`, JSON.stringify(backup.settings) === '{"autoFolders":false}');
check(`the tabs as the snapshot keeps them, private ones left out: ${JSON.stringify(backup.tabs.map(t => t.parent))}`,
  backup.tabs.length === 4 && backup.tabs[0].parent === 'f:rel' && backup.tabs[0].rank === 1 && backup.tabs[1].parent === 0
  && backup.tabs[2].parent === 'f:sub' && backup.tabs[3].parent === -1);
check('the declined tickets and the wallpaper', backup.declined['PROJ-9'] && backup.wallpaper?.name === 'sea.jpg');
check('no picture, no wallpaper', !('wallpaper' in backupOf({ tabs, ...stored, wallpaper: null })));
const back = readBackup(JSON.parse(JSON.stringify(backup)));
check('a backup reads back as it was written',
  JSON.stringify(back.folders) === JSON.stringify(stored.folders) && JSON.stringify(back.tabs) === JSON.stringify(backup.tabs)
  && JSON.stringify(back.ranks) === '{"f:sub":2}' && back.declined['PROJ-9'] && back.settings.autoFolders === false
  && JSON.stringify(back.wallpaper) === JSON.stringify(stored.wallpaper));

// A file from anywhere.
const refused = data => {
  try {
    readBackup(data);
    return false;
  } catch (e) {
    return e.message === 'not a TabTree backup';
  }
};
check("what isn't a backup is refused", [null, 'text', [], {}, { tabtree: 1 }, { tabtree: 2, tabs: [] }].every(refused));
const odd = readBackup({
  tabtree: 1,
  folders: {
    ok1: { name: '', color: 'magenta', parent: 'gone', created: 'x', key: 'not a key', auto: 'yes' },
    'Bad Id': { name: 'x', color: 'blue', parent: null, created: 1 },
    ok2: 'a folder',
  },
  ranks: { 'f:ok1': 3, 'f:gone': 1, 't:4': 2 },
  declined: { 'PROJ-1': true, '<b>': true, 'PROJ-2': 'yes' },
  settings: { autoFolders: false, onboarded: true, statuses: 'off', other: true },
  wallpaper: { dataUrl: 'javascript:alert(1)', tones: {} },
  tabs: [{ url: 'https://a.example.com/', parent: 7 }, { url: 'https://b.example.com/', parent: 'f:gone', rank: 'x' }, 'a tab', { url: 5, parent: 0 }],
});
check(`odd folders are mended or left out: ${JSON.stringify(odd.folders)}`,
  JSON.stringify(odd.folders) === '{"ok1":{"name":"Untitled","color":"grey","parent":null,"created":0}}');
check(`only the ranks of its folders, ticket keys, known switches: ${JSON.stringify([odd.ranks, odd.declined, odd.settings])}`,
  JSON.stringify(odd.ranks) === '{"f:ok1":3}' && JSON.stringify(odd.declined) === '{"PROJ-1":true}' && JSON.stringify(odd.settings) === '{"autoFolders":false}');
check("a wallpaper that isn't a picture is left out", odd.wallpaper === null);
check(`odd tabs keep their places in the list, with what can't be used dropped: ${JSON.stringify(odd.tabs)}`,
  JSON.stringify(odd.tabs) === '[{"url":"https://a.example.com/","title":"","parent":null},{"url":"https://b.example.com/","title":"","parent":null},'
  + '{"url":"","title":"","parent":null},{"url":"","title":"","parent":0}]');
const circle = [{ url: 'a', parent: 1 }, { url: 'b', parent: 2 }, { url: 'c', parent: 1 }];
check('parents that run in a circle come to an end', JSON.stringify(restoredParents(circle, new Map([[0, 10]]))) === '{}');

// The store's copy, installed next to the tabs and the island of the unpacked one. Its storage is new, so at start it
// turns the island into a folder of its own; then the unpacked copy's file comes in.
const o = makeOpera({
  tabs: [
    { id: 11, index: 0, title: '[PROJ-1] Initiative - Jira', url: J + 'PROJ-1', groupId: 71 },
    { id: 12, index: 1, title: '[PROJ-2] Epic - Jira', url: J + 'PROJ-2', groupId: 71 },
    { id: 13, index: 2, title: 'Dashboard', url: 'https://grafana.example.com/a', groupId: 71 },
    { id: 14, index: 3, title: 'Loose', url: 'https://example.com/' },
    { id: 15, index: 4, title: 'Opened since', url: 'https://new.example.com/' },
  ],
  groups: [{ id: 71, title: 'Release', color: 'blue' }],
  local: { settings: { onboarded: true, reuseTabs: false } },
});
await import('../probe/background.js');
await wait(1200);
const [own] = Object.keys(o.local.folders);
check('at start, the island became a folder of this copy', Object.keys(o.local.folders).length === 1 && o.local.folders[own].name === 'Release');

const reply = await o.ask({ type: 'importTree', backup: JSON.parse(JSON.stringify(backup)) });
await wait(1200);
check(`the reply says how it went: ${JSON.stringify(reply)}`, reply.ok && reply.folders === 2 && reply.matched === 4 && reply.saved === 4);
check(`the file's folders replace this copy's: ${Object.keys(o.local.folders)}`, Object.keys(o.local.folders).sort().join() === 'rel,sub');
check('the open tabs go back to their places', o.local.parents[11] === 'f:rel' && o.local.parents[12] === 11 && o.local.parents[13] === 'f:sub' && o.local.parents[14] === -1);
check('and to their order, with the folders',
  o.local.ranks['t:11'] === 1 && o.local.ranks['t:13'] === 1 && o.local.ranks['f:sub'] === 2 && !(`f:${own}` in o.local.ranks));
check("a tab the file doesn't know stays where it was", !(15 in o.local.parents));
check('the island stays and mirrors the imported folder: nothing moves',
  [11, 12, 13].every(id => o.tabs.get(id).groupId === 71) && o.groups.size === 1 && o.session.mirror['rel|1|w'] === 71);
check(`the switches join the ones here: ${JSON.stringify(o.local.settings)}`,
  o.local.settings.autoFolders === false && o.local.settings.reuseTabs === false && o.local.settings.onboarded === true);
check('the declined tickets and the wallpaper come along', o.local.declined['PROJ-9'] && o.local.wallpaper?.name === 'sea.jpg');
check('the log has it', o.local.log.some(e => e.ev === 'imported' && e.matched === 4 && e.folders === 2));
const bad = await o.ask({ type: 'importTree', backup: { hello: 'world' } });
check(`a file that isn't a backup changes nothing: ${bad.error}`, bad.ok === false && bad.error === 'not a TabTree backup' && Object.keys(o.local.folders).sort().join() === 'rel,sub');
done();
