// The tree as a file (Settings › Backup): the folders, where the tabs sit and in what order, the tickets kept out of
// automatic folders, the switches and the wallpaper. Tab ids last only as long as the browser session, so tabs are
// saved the way the snapshot saves them, and an import matches the open tabs back by URL. Pure.
import { snapshotOf } from './snapshot.js';
import { ISLAND_COLORS } from './titles.js';

export const BACKUP_FORMAT = 1;
const SWITCHES = ['autoFolders', 'mirrorIslands', 'reuseTabs', 'statuses', 'dimFinished', 'markChanged'];
const FOLDER_ID = /^[a-z0-9]+$/;
const TICKET = /^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/;
const WALLPAPER_NUMBERS = ['width', 'height', 'w', 'h', 'bytes', 'x', 'dim', 'blur'];

const isObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
const pick = (o, keep) => Object.fromEntries(Object.entries(isObject(o) ? o : {}).filter(keep));

// What Export writes. The setup guide's ticks stay behind: its steps differ from browser to browser.
export function backupOf({ tabs, parents = {}, ranks = {}, folders = {}, settings = {}, declined = {}, wallpaper = null }, savedAt = Date.now()) {
  return {
    // The key keeps the project's first name, so that files saved before the rename still read.
    tabtree: BACKUP_FORMAT,
    savedAt,
    folders,
    ranks: pick(ranks, ([k]) => k.startsWith('f:')),
    declined,
    settings: pick(settings, ([k]) => SWITCHES.includes(k)),
    ...(wallpaper?.dataUrl && { wallpaper }),
    tabs: snapshotOf(tabs, parents, ranks),
  };
}

// What Import takes from a file. The file may come from anywhere, so every piece is checked, and anything of another
// shape is left out.
export function readBackup(data) {
  if (!isObject(data) || data.tabtree !== BACKUP_FORMAT || !Array.isArray(data.tabs)) throw new Error('not a Branchy backup');
  const folders = readFolders(data.folders);
  const isFolder = p => typeof p === 'string' && p.startsWith('f:') && p.slice(2) in folders;
  const n = data.tabs.length;
  const tabs = data.tabs.map(s => {
    const t = isObject(s) ? s : {};
    const p = t.parent;
    return {
      url: typeof t.url === 'string' ? t.url : '',
      title: typeof t.title === 'string' ? t.title : '',
      parent: p === -1 || (Number.isInteger(p) && p >= 0 && p < n) || isFolder(p) ? p : null,
      ...(Number.isFinite(t.rank) && { rank: t.rank }),
    };
  });
  return {
    folders,
    tabs,
    ranks: pick(data.ranks, ([k, v]) => isFolder(k) && Number.isFinite(v)),
    declined: pick(data.declined, ([k, v]) => TICKET.test(k) && v === true),
    settings: pick(data.settings, ([k, v]) => SWITCHES.includes(k) && typeof v === 'boolean'),
    wallpaper: readWallpaper(data.wallpaper),
  };
}

function readFolders(given) {
  const folders = {};
  for (const [id, f] of Object.entries(isObject(given) ? given : {})) {
    if (!FOLDER_ID.test(id) || !isObject(f)) continue;
    folders[id] = {
      name: typeof f.name === 'string' && f.name ? f.name.slice(0, 200) : 'Untitled',
      color: ISLAND_COLORS.includes(f.color) ? f.color : 'grey',
      parent: typeof f.parent === 'string' ? f.parent : null,
      created: Number.isFinite(f.created) ? f.created : 0,
      ...(typeof f.key === 'string' && TICKET.test(f.key) && { key: f.key }),
      ...(f.auto === true && { auto: true }),
    };
  }
  for (const f of Object.values(folders)) if (!(f.parent in folders)) f.parent = null;
  return folders;
}

function readWallpaper(w) {
  if (!isObject(w) || typeof w.dataUrl !== 'string' || !w.dataUrl.startsWith('data:image/') || !isObject(w.tones)) return null;
  if (!WALLPAPER_NUMBERS.every(k => Number.isFinite(w[k]))) return null;
  return { ...w, name: String(w.name ?? 'picture'), source: w.source === 'none' ? 'none' : 'file', accent: ['violet', 'blue'].includes(w.accent) ? 'violet' : 'wallpaper' };
}
