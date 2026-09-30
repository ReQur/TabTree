// Settings › Backup in the panel (probe/panel.js in jsdom): Export saves a file of the tree, Import sends a file to
// the background and says how it went.
import { resolveObjectURL } from 'node:buffer';
import { check, wait, done } from './helpers/check.js';
import { loadPanel } from './helpers/panel-env.js';

const tab = (id, title, url, extra = {}) => ({ id, index: id, windowId: 1, title, url, active: false, pinned: false, groupId: -1, favIconUrl: '', lastAccessed: 100, workspaceId: 'w', ...extra });
const p = await loadPanel({
  tabs: [
    tab(1, 'Dashboard A', 'https://grafana.example.com/a'),
    tab(2, 'Dashboard B', 'https://grafana.example.com/b'),
    tab(3, 'Loose', 'https://example.com/', { active: true, lastAccessed: 900 }),
  ],
  store: {
    folders: { rel: { name: 'Release', color: 'blue', parent: null, created: 1 } },
    parents: { 1: 'f:rel', 2: 'f:rel' },
    ranks: { 't:2': 1, 't:1': 2, 'f:rel': 1 },
    settings: { onboarded: true, dimFinished: false },
  },
  // What the background answers when the file is a backup.
  onMessage: m => (m.type === 'importTree' && m.backup.tabtree === 1 ? { reply: { ok: true, folders: 1, matched: 2, saved: 3 } } : null),
});
const { $ } = p;
const all = sel => [...p.w.document.querySelectorAll(sel)];
const option = name => all('.opt').find(o => o.querySelector('b').textContent === name);
const toast = () => $('#toasts .toast .grow')?.textContent;

$('#open-settings').click();
check('Settings › Backup has Export and Import', all('.settings .sub').some(s => s.textContent === 'Backup')
  && option('Export').querySelector('button').textContent === 'Export' && option('Import').querySelector('button').textContent === 'Import…');
option('Export').querySelector('button').click();
await wait(100);
const [file] = p.downloads;
check(`Export saves one file: ${file?.name}`, p.downloads.length === 1 && /^branchy-\d{4}-\d\d-\d\d\.json$/.test(file.name));
const saved = JSON.parse(await resolveObjectURL(file.href).text());
check('with the folders, where the tabs sit, and the switches',
  saved.tabtree === 1 && saved.folders.rel.name === 'Release' && saved.tabs.length === 3 && saved.tabs[0].parent === 'f:rel'
  && saved.tabs[1].rank === 1 && saved.settings.dimFinished === false && !('onboarded' in saved.settings));
check(`and says so: «${toast()}»`, toast() === 'Exported 1 folder and 3 tabs');

const pick = (name, text) => {
  Object.defineProperty($('#backup-input'), 'files', { value: [{ name, text: async () => text }], configurable: true });
  $('#backup-input').dispatchEvent(new p.w.Event('change'));
};
pick('branchy-2026-09-30.json', JSON.stringify(saved));
await wait(100);
check('Import hands the file to the background', p.last()?.type === 'importTree' && p.last().backup.folders.rel.name === 'Release');
check(`and says how it went: «${toast()}»`, toast() === 'Imported 1 folder · 2 of 3 tabs back in place');
pick('notes.txt', 'not JSON');
await wait(100);
check(`a file that isn't JSON goes nowhere: «${toast()}»`,
  toast() === "notes.txt isn't a Branchy backup" && !!$('#toasts .toast.err') && p.sent.filter(m => m.type === 'importTree').length === 1);
done();
