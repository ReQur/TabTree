import { ticketKey, cleanTitle, rowLabel, kindLabel, hostOf, urlKey, islandName, colorFor } from './titles.js';
import { buildTree, tabIdsUnder, nodeRef, folderRef } from './tree.js';
import { icon } from './icons.js';
import { tonesOf, wallTokens } from './wallpaper.js';
import { detectSites, probeSite, originPattern, KIND_NAMES, PAGE_TO_OPEN } from './integrations.js';

const $ = sel => document.querySelector(sel);
const listEl = $('#list');
const pinnedEl = $('#pinned');
const statsEl = $('#stats');
const islandsEl = $('#islands');
const qEl = $('#q');
const selBar = $('#selbar');

for (const e of document.querySelectorAll('[data-icon]')) e.prepend(icon(e.dataset.icon));

// Per-viewer UI conveniences only; losing them is harmless.
const prefs = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

// Chromium tab group colors, which folders share with the islands that mirror them (`.c-<color>` in panel.css).
const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

const SETUP_STEPS = [
  ['pin', 'Pin this panel', "The pin in the panel's title bar keeps it next to the page."],
  ['tabs', "Collapse Opera's tabs", 'Settings › Browser › Tabs: vertical tabs, collapsed to a column of icons.'],
  ['islands', 'Turn off automatic Tab Islands', 'TabTree makes islands from your folders.'],
];

let view = prefs.get('view') === 'log' ? 'log' : 'tree'; // 'tree', 'log' or 'settings'
const collapsed = new Set(prefs.get('collapsed', []));
let allTabs = []; // every tab of the window, all Opera workspaces
let tabs = []; // the workspace in use
let otherIds = new Set(); // tabs of the other workspaces
let parents = {}; // tab id -> parent tab id, "f:<folder id>", or -1 for the top level
let folders = {}; // folder id -> { name, color, parent, created }
let ranks = {}; // "t:<id>" / "f:<id>" -> order among siblings
let settings = {}; // autoFolders, mirrorIslands, onboarded, setup
let declined = {}; // tickets that never get an automatic folder
let root = null; // the tree drawn last
let treeNodes = new Map(); // tab id -> node of that tree
let nodeByRef = new Map(); // "t:<id>" / "f:<id>" -> node of that tree
let visible = []; // refs of the drawn tree rows, top to bottom
let dupIds = new Set(); // extra copies of an already open URL
let hits = [];
let selected = 0;
let paused = false; // rendering is frozen while dragging, renaming, a menu is open, or the copy fallback shows
let missed = false; // something asked for a render while it was frozen
let pendingRename = null; // a folder to rename as soon as it is drawn
let guideLater = false; // "Later" on the setup guide hides it until the panel is opened again
let granted = new Set(); // origin patterns Opera lets the extension request (optional host permissions)
let apiProbe = {}; // the background's last probe answers, per site: { kind, origin, t, results } or { t, error }
const panelProbes = new Map(); // this panel's own probe answers, per site
const testing = new Set(); // sites whose probe is on its way

async function load() {
  let list = await chrome.tabs.query({ currentWindow: true });
  if (!list.length) list = await chrome.tabs.query({ lastFocusedWindow: true });
  allTabs = list.sort((a, b) => a.index - b.index);
  const { current, others } = splitWorkspaces(allTabs);
  tabs = current;
  otherIds = new Set(others.map(t => t.id));
  dupIds = findDuplicates(tabs);
  const stored = await chrome.storage.local.get(['parents', 'folders', 'ranks', 'settings', 'declined', 'apiProbe']);
  parents = stored.parents ?? {};
  folders = stored.folders ?? {};
  ranks = stored.ranks ?? {};
  settings = stored.settings ?? {};
  declined = stored.declined ?? {};
  apiProbe = stored.apiProbe ?? {};
  granted = new Set((await chrome.permissions?.getAll?.())?.origins ?? []);
}

// Opera lists the tabs of every workspace in one window and tags each with workspaceId/workspaceName.
// Every workspace keeps its own active tab; the one in use is the workspace whose active tab was shown last.
function splitWorkspaces(list) {
  const shownAt = new Map();
  for (const t of list) {
    if (t.active) shownAt.set(t.workspaceId, Math.max(shownAt.get(t.workspaceId) ?? -1, t.lastAccessed ?? 0));
  }
  let current = list[0]?.workspaceId;
  for (const [ws, at] of shownAt) if (at > (shownAt.get(current) ?? -1)) current = ws;
  return {
    current: list.filter(t => t.workspaceId === current),
    others: list.filter(t => t.workspaceId !== current),
  };
}

// Keeps the active or most recently used copy of each URL; the rest are duplicates.
function findDuplicates(list) {
  const byUrl = new Map();
  for (const t of list) {
    const k = urlKey(t);
    if (!k) continue;
    if (!byUrl.has(k)) byUrl.set(k, []);
    byUrl.get(k).push(t);
  }
  const extra = new Set();
  for (const copies of byUrl.values()) {
    if (copies.length < 2) continue;
    const [keep] = [...copies].sort(
      (a, b) => b.active - a.active || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) || a.index - b.index,
    );
    for (const t of copies) if (t !== keep) extra.add(t.id);
  }
  return extra;
}

// Every change to the tree is made by the background, which also keeps the islands in step.
async function send(msg) {
  const res = await chrome.runtime.sendMessage(msg).catch(e => ({ error: e.message }));
  if (!res?.ok) toast(`${msg.type} failed: ${res?.error ?? 'no answer'}`, { error: true });
  return res;
}

// Writes one setting; `value` may be a function of the stored one. Writes are queued, so that quick clicks don't
// overwrite each other's changes.
let settingsQueue = Promise.resolve();
function setSetting(name, value) {
  const write = async () => {
    const { settings: current = {} } = await chrome.storage.local.get('settings');
    const next = typeof value === 'function' ? value(current[name]) : value;
    await chrome.storage.local.set({ settings: { ...current, [name]: next } });
  };
  settingsQueue = settingsQueue.then(write, write);
  return settingsQueue;
}

// ---- actions on folders, tabs and branches ----

const newFolderId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// A new folder goes after the other folders of its level, and gets renamed right away.
async function addFolder(parentNode) {
  const id = newFolderId();
  const siblings = parentNode.children;
  const at = siblings.filter(n => n.folder).length;
  const order = [...siblings.slice(0, at).map(nodeRef), folderRef(id), ...siblings.slice(at).map(nodeRef)];
  if (parentNode.folder) collapsed.delete(`${view}:${nodeRef(parentNode)}`);
  pendingRename = id;
  await send({ type: 'newFolder', id, parent: parentNode.folder?.id ?? null, order });
}

// A folder made for a ticket is named after it, colored by its key, and remembers the key, so that deleting
// the folder keeps automatic folders away from that ticket.
const ticketFolder = node => ({
  name: islandName(node.ticket.key, node.ticket.title),
  color: colorFor(node.ticket.key),
  key: node.ticket.key,
});

// A new folder in place of the first of `nodes`, on the nearest level that can hold folders, with `nodes`
// inside. Without a name it opens for renaming.
function nodesToFolder(nodes, props = {}) {
  if (!nodes.length) return;
  let spot = nodes[0];
  while (spot.parent.tab) spot = spot.parent;
  const level = spot.parent;
  const id = newFolderId();
  const order = level.children.flatMap(n => [...(n === spot ? [folderRef(id)] : []), ...(nodes.includes(n) ? [] : [nodeRef(n)])]);
  if (!props.name) pendingRename = id;
  send({ type: 'newFolder', id, parent: level.folder?.id ?? null, items: nodes.map(nodeRef), order, ...props });
}

const familyToFolder = node => nodesToFolder([node], ticketFolder(node));

function moveToTop(nodes) {
  const refs = nodes.map(nodeRef);
  const order = [...root.children.map(nodeRef).filter(r => !refs.includes(r)), ...refs];
  send({ type: 'place', nodes: refs, parent: 'root', order });
}

function reload(ids) {
  for (const id of ids) chrome.tabs.reload(id).catch(() => {});
}

// Opera can't unload the tab you are looking at; the others leave memory and load again when opened.
function unload(ids) {
  for (const id of ids) {
    if (!tabs.find(t => t.id === id)?.active) chrome.tabs.discard(id).catch(() => {});
  }
}

// The clipboard API, and failing that the old execCommand, which still works where the API refuses (in a panel
// that doesn't have the focus, for one).
async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  const box = el('textarea', 'offscreen');
  box.value = text;
  document.body.append(box);
  box.focus();
  box.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {}
  box.remove();
  return copied;
}

async function copyText(text, done) {
  if (await writeClipboard(text)) toast(done);
  else toast('The clipboard refused', { error: true });
}

// Branches as a nested Markdown list, to paste into a ticket or notes.
function markdownOf(nodes) {
  const lines = [];
  const walk = (n, depth) => {
    const indent = '  '.repeat(depth);
    if (n.folder) {
      lines.push(`${indent}- **${n.folder.name}**`);
    } else {
      const { text } = cleanTitle(n.tab, n.ticket?.key ?? n.groupKey);
      const title = n.ticket ? `${n.ticket.key} ${text}` : text;
      lines.push(`${indent}- [${title.replace(/[[\]]/g, '\\$&')}](${n.tab.url})`);
    }
    for (const c of n.children) walk(c, depth + 1);
  };
  for (const n of nodes) walk(n, 0);
  return lines.join('\n');
}

// ---- selection ----
// Ctrl+click adds or removes a row; Shift+click selects the rows from the anchor to this one (with Ctrl too,
// it adds them to the selection). The anchor is the row clicked last without Shift, plain clicks included;
// a click on the empty part of the list, or Esc, drops both the selection and the anchor.
// A selection is dragged as a whole, put into a new folder, or closed.

const selection = new Set(); // refs of selected rows
let anchor = null;
let armed = 0; // timer while "Close" waits for its confirming second click

// Returns true when the click was about selecting; a plain click only moves the anchor and clears the
// selection, and the caller goes on to open the tab or fold the folder.
function clickSelects(e, node) {
  const ref = nodeRef(node);
  const adding = e.ctrlKey || e.metaKey;
  if (e.shiftKey) {
    const from = visible.indexOf(anchor);
    const to = visible.indexOf(ref);
    if (!adding) selection.clear();
    if (from === -1) {
      selection.add(ref);
      anchor = ref;
    } else {
      for (const r of visible.slice(Math.min(from, to), Math.max(from, to) + 1)) selection.add(r);
    }
  } else if (adding) {
    if (selection.has(ref)) selection.delete(ref);
    else selection.add(ref);
    anchor = ref;
  } else {
    anchor = ref;
    clearSelection();
    return false;
  }
  render();
  return true;
}

function forgetSelection() {
  anchor = null;
  clearSelection();
}

listEl.addEventListener('click', e => {
  if (e.target === listEl) forgetSelection();
});

function clearSelection() {
  if (!selection.size) return;
  selection.clear();
  disarm();
  render();
}

// What the selection stands for: a ticket's own page means its ticket, and whatever sits under another
// selected row goes along with that row. In the order they are drawn.
function selectedNodes() {
  const picked = new Set();
  for (const ref of selection) {
    const n = nodeByRef.get(ref);
    if (n) picked.add(n.groupKey ? n.parent : n);
  }
  const at = n => visible.indexOf(nodeRef(n));
  return [...picked].filter(n => ![...picked].some(o => o !== n && inside(n, o))).sort((a, b) => at(a) - at(b));
}

const foldersUnder = n => [...(n.folder ? [n.folder.id] : []), ...n.children.flatMap(foldersUnder)];

// "5 tabs, 1 folder"; the confirming question joins them with "and".
function describe(nodes, joiner = ', ') {
  const tabCount = new Set(nodes.flatMap(tabIdsUnder)).size;
  const folderCount = nodes.flatMap(foldersUnder).length;
  return [tabCount && plural(tabCount, 'tab'), folderCount && plural(folderCount, 'folder')].filter(Boolean).join(joiner);
}

function closeSelection() {
  const nodes = selectedNodes();
  send({ type: 'closeItems', tabIds: [...new Set(nodes.flatMap(tabIdsUnder))], folderIds: nodes.flatMap(foldersUnder) });
  selection.clear();
  anchor = null;
  disarm();
  render();
}

function selectionToFolder() {
  const nodes = selectedNodes();
  selection.clear();
  anchor = null;
  nodesToFolder(nodes);
  render();
}

// The bar floats above the status bar while rows are selected. Armed, it asks before closing: the question,
// Close and Cancel, and a strip that runs down over the seconds left.
function renderSelBar() {
  const nodes = selectedNodes();
  selBar.hidden = !nodes.length || view !== 'tree';
  document.body.classList.toggle('selecting', !selBar.hidden);
  if (selBar.hidden) {
    disarm();
    return;
  }
  const on = !!armed;
  selBar.classList.toggle('armed', on);
  selBar.setAttribute('role', on ? 'alertdialog' : 'toolbar');
  selBar.setAttribute('aria-label', on ? 'Confirm closing' : 'Selection');
  $('#sel-count').textContent = `${selection.size} selected`;
  $('#sel-what').textContent = on ? `Close ${describe(nodes, ' and ')}?` : describe(nodes) || 'nothing';
  $('#sel-what').title = $('#sel-what').textContent;
  $('#sel-close').classList.toggle('danger', on);
  $('#sel-close').classList.toggle('sm', on);
  for (const id of ['#sel-count', '#sel-folder', '#sel-clear']) $(id).hidden = on;
  $('#sel-cancel').hidden = !on;
  selBar.querySelector('.timer').hidden = !on;
}

function disarm() {
  if (!armed) return;
  clearTimeout(armed);
  armed = 0;
  renderSelBar();
}

$('#sel-folder').onclick = selectionToFolder;
$('#sel-clear').onclick = forgetSelection;
$('#sel-cancel').onclick = disarm;
// Closing one tab needs no confirmation; anything bigger takes a second click within a few seconds.
$('#sel-close').onclick = () => {
  const nodes = selectedNodes();
  const big = new Set(nodes.flatMap(tabIdsUnder)).size > 1 || nodes.some(n => n.folder);
  if (big && !armed) {
    armed = setTimeout(() => {
      armed = 0;
      renderSelBar();
    }, 4000);
    renderSelBar();
    return;
  }
  closeSelection();
};

// ---- menus ----
// One menu at a time, from ⋯ on a row or a right click: for a folder, for a tab, for the selection (when the
// clicked row is part of it), or for the empty list. It closes on a click elsewhere, Esc, scrolling, or once
// one of its items is used; the tree is not redrawn meanwhile.

const menuEl = el('div', 'menu');
menuEl.setAttribute('role', 'menu');
menuEl.hidden = true;
document.body.append(menuEl);

let menuRow = null; // the row whose menu is open: it keeps its actions shown

// Items are { label, icon, hint, key, danger, run } (hint: a line under the label; key: a shortcut on the
// right), { colors: current, run(color) }, or '-' between groups; falsy items are left out. `at` is where to
// open: a point, or the right edge of the ⋯ button (alignRight). The row of `ref` keeps its buttons shown
// meanwhile; it is looked up here, because making the items may have redrawn the list.
function openMenu(items, at, ref = null) {
  paused = true;
  menuRow?.classList.remove('menu-open');
  menuRow = ref && listEl.querySelector(`.row[data-ref="${ref}"]`);
  menuRow?.classList.add('menu-open');
  menuRow?.querySelector('.more')?.setAttribute('aria-expanded', 'true');
  menuEl.replaceChildren();
  let gap = false;
  for (const item of items.filter(Boolean)) {
    if (item === '-') {
      gap = menuEl.childElementCount > 0;
      continue;
    }
    if (gap) menuEl.append(el('div', 'msep'));
    gap = false;
    menuEl.append(item.colors ? swatches(item) : menuItem(item));
  }
  menuEl.hidden = false;
  const { width = 0, height = 0 } = menuEl.getBoundingClientRect();
  const W = document.documentElement.clientWidth;
  const H = document.documentElement.clientHeight;
  const x = (at.x ?? 0) - (at.alignRight ? width : 0);
  const y = at.y ?? 0;
  menuEl.style.left = `${Math.max(4, Math.min(x, W - width - 4))}px`;
  menuEl.style.top = `${y + height > H - 4 ? Math.max(4, (at.above ?? y) - height) : y}px`;
  menuEl.querySelector('button')?.focus();
}

// Redraws only when something changed meanwhile: a redraw between mousedown and mouseup would swallow the
// click that closed the menu.
function closeMenu() {
  if (menuEl.hidden) return;
  menuEl.hidden = true;
  menuRow?.classList.remove('menu-open');
  menuRow?.querySelector('.more')?.removeAttribute('aria-expanded');
  menuRow = null;
  paused = false;
  if (missed) refresh();
}

function menuItem({ label, icon: name, hint, key, danger, run }) {
  const b = el('button', ['mi', hint && 'tall', danger && 'danger'].filter(Boolean).join(' '));
  b.setAttribute('role', 'menuitem');
  const words = el('span', 'words');
  words.append(el('span', 'label', label));
  if (hint) words.append(el('small', 'hint', hint));
  b.append(name ? icon(name) : el('span', 'i'), words);
  if (key) b.append(el('small', 'hint sc', key));
  b.onclick = () => {
    closeMenu();
    run();
  };
  return b;
}

// The nine colors under a "Color" label; the folder's own one is ringed.
function swatches({ colors: current, run }) {
  const label = el('div', 'mlabel');
  label.append(icon('color'), 'Color');
  const box = el('div', 'swatches');
  box.setAttribute('role', 'radiogroup');
  box.setAttribute('aria-label', 'Folder color');
  for (const color of COLORS) {
    const b = el('button', `sw c-${color}${color === current ? ' on' : ''}`);
    b.title = color[0].toUpperCase() + color.slice(1);
    b.setAttribute('aria-label', b.title);
    b.dataset.color = color;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(color === current));
    b.onclick = () => {
      closeMenu();
      run(color);
    };
    box.append(b);
  }
  const both = document.createDocumentFragment();
  both.append(label, box);
  return both;
}

// Right-clicking a row outside the selection works on that row alone, as in a file manager.
function menuFor(node) {
  const ref = nodeRef(node);
  if (selection.has(ref) && selection.size > 1) return selectionMenu();
  if (!selection.has(ref)) {
    anchor = ref;
    clearSelection();
  }
  node = nodeByRef.get(ref) ?? node;
  return node.folder ? folderMenu(node) : tabMenu(node);
}

function folderMenu(node) {
  const f = node.folder;
  const ids = tabIdsUnder(node);
  const dups = ids.filter(id => dupIds.has(id));
  return [
    { label: 'New folder inside', icon: 'newFolder', run: () => addFolder(node) },
    {
      label: 'Rename',
      icon: 'rename',
      run: () => {
        pendingRename = f.id;
        render();
      },
    },
    { colors: f.color, run: color => send({ type: 'colorFolder', id: f.id, color }) },
    dups.length > 0 && { label: `Close ${plural(dups.length, 'duplicate')}`, icon: 'copy', run: () => chrome.tabs.remove(dups) },
    ids.length > 0 && { label: 'Copy links as Markdown', icon: 'copy', run: () => copyText(markdownOf([node]), 'Links copied') },
    '-',
    {
      label: 'Delete folder',
      icon: 'delete',
      hint: 'Its tabs move one level up',
      danger: true,
      run: () => send({ type: 'deleteFolder', id: f.id }),
    },
  ];
}

function tabMenu(node) {
  const t = node.tab;
  const branch = tabIdsUnder(node);
  const many = branch.length > 1;
  // A ticket's own page moves with its ticket, as it does when dragged.
  const unit = node.groupKey ? node.parent : node;
  return [
    { label: 'Close tab', icon: 'close', key: 'Middle click', run: () => chrome.tabs.remove(t.id) },
    many && {
      label: `Close ${branch.length} tabs`,
      icon: 'closeTabs',
      hint: 'This tab and everything under it',
      run: () => chrome.tabs.remove(branch),
    },
    '-',
    { label: 'Put into a new folder', icon: 'toFolder', run: () => nodesToFolder([unit], unit.ticket ? ticketFolder(unit) : {}) },
    !unit.parent?.root && { label: 'Move to the top level', icon: 'dropZone', run: () => moveToTop([unit]) },
    '-',
    { label: 'Copy link', icon: 'copy', run: () => copyText(t.url, 'Link copied') },
    many && { label: 'Copy links as Markdown', icon: 'copy', run: () => copyText(markdownOf([node]), 'Links copied') },
    '-',
    { label: many ? `Reload ${branch.length} tabs` : 'Reload', run: () => reload(branch) },
    { label: many ? `Unload ${branch.length} tabs` : 'Unload from memory', hint: 'Loads again when opened', run: () => unload(branch) },
  ];
}

function selectionMenu() {
  const nodes = selectedNodes();
  const ids = [...new Set(nodes.flatMap(tabIdsUnder))];
  return [
    { label: `Put ${plural(nodes.length, 'item')} into a new folder`, icon: 'toFolder', run: selectionToFolder },
    nodes.some(n => !n.parent?.root) && { label: 'Move to the top level', icon: 'dropZone', run: () => moveToTop(nodes) },
    ids.length > 0 && { label: 'Copy links as Markdown', icon: 'copy', run: () => copyText(markdownOf(nodes), 'Links copied') },
    '-',
    ids.length > 0 && { label: `Reload ${plural(ids.length, 'tab')}`, run: () => reload(ids) },
    ids.length > 0 && { label: `Unload ${plural(ids.length, 'tab')}`, run: () => unload(ids) },
    '-',
    { label: `Close ${describe(nodes)}`, icon: 'closeTabs', danger: true, run: closeSelection },
  ];
}

function moreButton(node) {
  const b = iconButton('ab more', 'more', 'More actions', 'More actions (right click)', () => {
    const r = b.getBoundingClientRect();
    openMenu(menuFor(node), { x: r.right, y: (r.bottom ?? 0) + 2, above: (r.top ?? 0) - 2, alignRight: true }, nodeRef(node));
  });
  b.setAttribute('aria-haspopup', 'menu');
  return b;
}

const onRightClick = (row, node) => {
  row.oncontextmenu = e => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(menuFor(node), { x: e.clientX, y: e.clientY }, nodeRef(node));
  };
};

listEl.addEventListener('contextmenu', e => {
  if (e.target !== listEl || view !== 'tree' || qEl.value.trim()) return;
  e.preventDefault();
  openMenu([{ label: 'New folder', icon: 'newFolder', run: () => addFolder(root) }], { x: e.clientX, y: e.clientY });
});
document.addEventListener('mousedown', e => {
  if (!menuEl.hidden && !menuEl.contains(e.target)) closeMenu();
}, true);
listEl.addEventListener('scroll', closeMenu);
window.addEventListener('blur', closeMenu);
menuEl.addEventListener('keydown', e => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = [...menuEl.querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
});

// The name is applied while typing and kept when the field loses focus; Esc puts the old name back.
function startRename(row, folderId) {
  paused = true;
  row.draggable = false;
  const original = folders[folderId]?.name ?? '';
  const input = el('input', 'rename');
  input.value = original;
  input.placeholder = 'Folder name';
  input.setAttribute('aria-label', 'Folder name');
  const keys = [el('kbd', 'k', '↵'), el('kbd', 'k', 'Esc')];
  keys[0].title = 'Enter keeps the name';
  keys[1].title = 'Esc puts the old name back';
  row.classList.add('renaming');
  row.querySelector('.title').replaceWith(input, ...keys);
  input.focus();
  input.select();
  const save = name => send({ type: 'renameFolder', id: folderId, name });
  let pending = 0;
  input.oninput = () => {
    clearTimeout(pending);
    pending = setTimeout(() => save(input.value.trim()), 250);
  };
  let done = false;
  const finish = async name => {
    if (done) return;
    done = true;
    clearTimeout(pending);
    await save(name);
    paused = false;
    refresh();
  };
  input.onclick = e => e.stopPropagation();
  input.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') finish(original);
  };
  input.onblur = () => finish(input.value.trim());
}

// The tabs of the other workspaces, one group per workspace.
function otherWorkspaces() {
  const byWs = new Map();
  for (const t of allTabs) {
    if (!otherIds.has(t.id)) continue;
    if (!byWs.has(t.workspaceId)) byWs.set(t.workspaceId, { name: t.workspaceName, list: [] });
    byWs.get(t.workspaceId).list.push(t);
  }
  return [...byWs].map(([ws, { name, list }]) => ({
    group: { id: `ws:${ws}`, title: name || String(ws), defaultCollapsed: true },
    children: list.map(t => ({ tab: t, children: [] })),
  }));
}

// ---- rendering ----

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---- drag and drop ----
// Drop on the upper or lower edge of a row to put the dragged item before or after it on the same level;
// on its middle to put it inside (into a folder, or under a tab); on the zone below the list to put it last
// on the top level. A ticket's own page can be reordered among the ticket's pages; dropped anywhere else,
// it takes the whole ticket along. Grabbing a selected row drags the whole selection.

let drag = null; // { node, ticket } for one row (ticket: the root, for a ticket's own page), or { many }
const topZone = el('div', 'drop-zone');
topZone.append(icon('dropZone'), 'Drop here: last on the top level');
// Before and after: a line where the item will land, at its depth (the target row's).
const dropLine = el('i', 'dl');

const inside = (node, ancestor) => {
  for (let n = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
};

function zoneOf(e, row) {
  const r = row.getBoundingClientRect();
  const y = r.height ? (e.clientY - r.top) / r.height : 0.5;
  return y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'inside';
}

function draggedNodes(target, zone) {
  if (drag.many) return drag.many;
  const reorderPage = drag.ticket && zone !== 'inside' && target.parent === drag.node.parent;
  return [drag.ticket && !reorderPage ? drag.ticket : drag.node];
}

// What a drop does, as a message for the background; null when the items can't go there.
function placement(target, zone) {
  const moving = draggedNodes(target, zone);
  const parent = zone === 'inside' ? target : target.parent;
  if (!parent || moving.includes(target) || moving.some(m => inside(parent, m))) return null;
  if (parent.tab && moving.some(m => m.folder)) return null; // folders live in folders or at the top level
  const siblings = parent.children.filter(n => !moving.includes(n));
  const at = zone === 'inside' ? siblings.length : siblings.indexOf(target) + (zone === 'after' ? 1 : 0);
  siblings.splice(at, 0, ...moving);
  return { type: 'place', nodes: moving.map(nodeRef), parent: nodeRef(parent), order: siblings.map(nodeRef) };
}

// What the pointer carries: the row's favicon (or folder glyph) and title, and how many rows go along.
function dragImage(e, node) {
  const lead = drag.many?.[0] ?? node;
  const ghost = el('div', 'ghost');
  if (lead.folder) {
    ghost.append(folderGlyph(lead.folder.color), el('span', 'title', lead.folder.name));
  } else {
    ghost.append(favicon(lead.tab));
    if (lead.ticket) ghost.append(el('span', 'key', lead.ticket.key));
    ghost.append(el('span', 'title', labelOf(lead).text));
  }
  if (drag.many) ghost.append(el('span', 'count', String(drag.many.length)));
  document.body.append(ghost);
  e.dataTransfer.setDragImage?.(ghost, 14, 14);
  // The browser takes its picture of the element when dragstart returns.
  setTimeout(() => ghost.remove());
}

function dragAndDrop(row, node) {
  row.draggable = true;
  row.ondragstart = e => {
    closeMenu();
    drag = selection.has(nodeRef(node)) && selection.size > 1
      ? { many: selectedNodes() }
      : { node, ticket: node.groupKey ? node.parent : null };
    paused = true; // a re-render would remove the row being dragged
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', nodeRef(node));
    dragImage(e, node);
    row.classList.add('dragging');
    listEl.append(topZone);
  };
  row.ondragend = () => {
    drag = null;
    topZone.remove();
    dropLine.remove();
    paused = false;
    refresh();
  };
  const clear = () => {
    row.classList.remove('drop-before', 'drop-after', 'drop-inside');
    if (dropLine.parentNode === row) dropLine.remove();
  };
  row.ondragover = e => {
    if (!drag) return;
    const zone = zoneOf(e, row);
    clear();
    if (!placement(node, zone)) return;
    e.preventDefault();
    e.stopPropagation();
    row.classList.add(`drop-${zone}`);
    if (zone !== 'inside') {
      dropLine.className = `dl ${zone}`;
      row.append(dropLine);
    }
  };
  row.ondragleave = clear;
  row.ondrop = e => {
    const msg = drag && placement(node, zoneOf(e, row));
    clear();
    if (!msg) return;
    e.preventDefault();
    e.stopPropagation();
    send(msg);
  };
}

topZone.ondragover = e => {
  if (!drag) return;
  e.preventDefault();
  topZone.classList.add('drop');
};
topZone.ondragleave = () => topZone.classList.remove('drop');
topZone.ondrop = e => {
  if (!drag) return;
  e.preventDefault();
  topZone.classList.remove('drop');
  const moving = drag.many ?? [drag.ticket ?? drag.node];
  const order = [...root.children.filter(n => !moving.includes(n)), ...moving].map(nodeRef);
  send({ type: 'place', nodes: moving.map(nodeRef), parent: 'root', order });
};

const activate = t => chrome.tabs.update(t.id, { active: true });
const nextColor = color => COLORS[(COLORS.indexOf(color) + 1) % COLORS.length];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const islandsOn = () => !!chrome.tabGroups && settings.mirrorIslands !== false;

function button(cls, text, title, onClick) {
  const b = el('button', cls, text);
  b.title = title;
  b.onclick = e => {
    e.stopPropagation();
    onClick();
  };
  return b;
}

// A button that shows only an icon names itself for screen readers, and in its tooltip.
function iconButton(cls, name, label, title, onClick) {
  const b = button(cls, null, title, onClick);
  b.setAttribute('aria-label', label);
  b.append(icon(name));
  return b;
}

// A folder's color as the folder glyph (rows, menus) or as a small square (paths, islands).
function folderGlyph(color) {
  const dot = el('span', `dot c-${color}`);
  dot.append(icon('folder', ''));
  return dot;
}

const colorSquare = color => el('span', `sq c-${color}`);

function favicon(t) {
  const letter = () => el('span', 'noicon', (hostOf(t.url).replace(/^www\./, '')[0] || '•').toUpperCase());
  if (!t.favIconUrl || /^(chrome|opera|edge|about):/.test(t.favIconUrl)) return letter();
  const img = el('img', 'icon');
  img.alt = '';
  img.src = t.favIconUrl;
  img.onerror = () => img.replaceWith(letter());
  return img;
}

function toggle(id) {
  if (collapsed.has(id)) collapsed.delete(id);
  else collapsed.add(id);
  prefs.set('collapsed', [...collapsed].slice(-500));
  render();
}

// The chevron of a row with children (`open` true or false), or an empty slot.
function twisty(open, onClick) {
  const tw = el('span', open ? 'twisty open' : 'twisty');
  if (open != null) tw.append(icon('twisty'));
  if (onClick) {
    tw.onclick = e => {
      e.stopPropagation();
      onClick();
    };
  }
  return tw;
}

const KIND_ICONS = { mr: 'mr', pipeline: 'pipeline', job: 'job', build: 'build' };

// A page kind as an icon and a number ("!820 · changes"); the words are in its tooltip.
function kindTag(kind) {
  const tag = el('span', 'kind');
  tag.title = kind.label;
  if (KIND_ICONS[kind.type]) tag.append(icon(KIND_ICONS[kind.type], 'i s'));
  tag.append(kind.number ? kind.number + (kind.view ? ` · ${kind.view}` : '') : kind.label);
  return tag;
}

function countPill(text, title) {
  const pill = el('span', 'count', text);
  if (title) pill.title = title;
  return pill;
}

// The buttons a row shows on hover, in place of its count.
function actions(...buttons) {
  const box = el('span', 'acts');
  box.append(...buttons.filter(Boolean));
  return box;
}

function grip() {
  const handle = el('span', 'ab grip');
  handle.title = 'Drag to move';
  handle.setAttribute('aria-hidden', 'true');
  handle.append(icon('drag'));
  return handle;
}

function dupButton(ids) {
  const dups = ids.filter(tid => dupIds.has(tid));
  if (!dups.length) return [];
  const b = button('badge dup', null, 'Close extra copies, keep the active or most recently used one', () => chrome.tabs.remove(dups));
  b.setAttribute('aria-label', `Close ${plural(dups.length, 'duplicate')}`);
  b.append(icon('close', 'i s'), plural(dups.length, 'dup'));
  return [b];
}

let rail = null; // the island being drawn: its color, and its last row so far

// A row's depth sets its indent and guides; a row inside an island carries the island's color for the rail.
function placeRow(row, depth) {
  row.style.setProperty('--d', depth);
  if (!rail) return;
  row.classList.add('isl', `c-${rail.color}`);
  rail.last = row;
}

// What a tab row reads: a ticket's page that only repeats the ticket's title reads as its kind.
function labelOf(node) {
  if (node.ticket) return rowLabel(node.tab, node.ticket.key, null);
  if (node.groupKey) return rowLabel(node.tab, node.groupKey, node.groupTitle);
  return rowLabel(node.tab, null, null);
}

function tabRow(t, depth, { open, onTwisty, key, label } = {}) {
  const row = el('div', 'row');
  placeRow(row, depth);
  row.classList.toggle('current', !!t.active);
  row.classList.toggle('discarded', !!t.discarded);
  row.append(twisty(open, onTwisty), favicon(t));
  if (key) row.append(el('span', 'key', key));
  const { text, kind, draft, asKind } = label ?? rowLabel(t, null, null);
  row.append(el('span', asKind ? 'title as-kind' : 'title', text));
  if (kind) row.append(kindTag(kind));
  if (draft) row.append(el('span', 'badge draft', 'draft'));
  if (dupIds.has(t.id)) {
    const dup = el('span', 'badge dup', 'dup');
    dup.title = 'Another tab has the same URL';
    row.append(dup);
  }
  if (t.audible) {
    const sound = el('span', 'audible');
    sound.title = 'Playing sound';
    sound.append(icon('sound', 'i s'));
    row.append(sound);
  }
  row.title = `${t.title}\n${t.url}`;
  row.onclick = () => activate(t);
  row.onmousedown = e => {
    if (e.button === 1) e.preventDefault(); // no autoscroll on middle click
  };
  row.onauxclick = e => {
    if (e.button === 1) chrome.tabs.remove(t.id);
  };
  return row;
}

function folderCountTitle(n, topLevel) {
  if (!topLevel || !islandsOn() || n === 0) return plural(n, 'tab');
  return n >= 2 ? `${plural(n, 'tab')} · an island in Opera's tab strip` : '1 tab · no island: Opera keeps no one-tab islands';
}

function renderFolder(node, depth, out) {
  const f = node.folder;
  const id = `${view}:${nodeRef(node)}`;
  const isCollapsed = collapsed.has(id);
  const ids = tabIdsUnder(node);
  // A top-level folder with two or more tabs is an island: a rail in its color runs down all its rows.
  const island = depth === 0 && islandsOn() && ids.length >= 2;
  if (island) rail = { color: f.color, last: null };
  const row = el('div', 'row folder');
  row.dataset.folder = f.id;
  row.dataset.ref = nodeRef(node);
  placeRow(row, depth);
  row.classList.toggle('head', island);
  row.classList.toggle('selected', selection.has(nodeRef(node)));
  visible.push(nodeRef(node));
  const dot = folderGlyph(f.color);
  dot.title = 'Change color';
  dot.onclick = e => {
    e.stopPropagation();
    send({ type: 'colorFolder', id: f.id, color: nextColor(f.color) });
  };
  row.append(
    twisty(node.children.length ? !isCollapsed : undefined),
    dot,
    el('span', 'title', f.name),
    ...dupButton(ids),
    actions(iconButton('ab', 'newFolder', 'New folder inside', 'New folder inside', () => addFolder(node)), moreButton(node), grip()),
    countPill(String(ids.length), folderCountTitle(ids.length, depth === 0)),
  );
  row.onclick = e => {
    if (!clickSelects(e, node)) toggle(id);
  };
  onRightClick(row, node);
  dragAndDrop(row, node);
  out.append(row);
  if (!isCollapsed) for (const c of node.children) renderNode(c, depth + 1, out);
  if (island) {
    rail.last.classList.add('end');
    rail = null;
  }
}

// The other workspaces' tabs: a plain list, nothing to drag.
function renderGroup(node, depth, out) {
  const g = node.group;
  const id = `${view}:${g.id}`;
  // For groups that start collapsed the set remembers the opposite state.
  const isCollapsed = g.defaultCollapsed ? !collapsed.has(id) : collapsed.has(id);
  const row = el('div', 'row group');
  placeRow(row, depth);
  row.title = `Workspace ${g.title}: its tabs open there`;
  row.append(twisty(!isCollapsed), icon('workspace', 'i ws'), el('span', 'title', g.title), countPill(String(node.children.length)));
  row.onclick = () => toggle(id);
  out.append(row);
  if (!isCollapsed) for (const c of node.children) out.append(tabRow(c.tab, depth + 1));
}

function renderNode(node, depth, out) {
  if (node.folder) return renderFolder(node, depth, out);
  const t = node.tab;
  const id = `${view}:${nodeRef(node)}`;
  const hasKids = node.children.length > 0;
  const isCollapsed = hasKids && collapsed.has(id);
  const { ticket } = node;
  const row = tabRow(t, depth, {
    open: hasKids ? !isCollapsed : undefined,
    onTwisty: hasKids ? () => toggle(id) : undefined,
    key: ticket?.key,
    label: labelOf(node),
  });
  // A top-level ticket can become a folder; its actions leave out the drag handle to stay three wide.
  const toFolder = ticket && node.parent?.root && iconButton('ab', 'toFolder', `Put ${ticket.key} into a new folder`,
    `Put ${ticket.key} and everything under it into a new folder`, () => familyToFolder(node));
  row.append(actions(
    toFolder,
    iconButton('ab', 'close', 'Close tab', 'Close tab (middle click)', () => chrome.tabs.remove(t.id)),
    moreButton(node),
    !toFolder && grip(),
  ));
  const folded = tabIdsUnder(node).length - 1;
  if (isCollapsed) row.append(countPill(`+${folded}`, `${plural(folded, 'tab')} folded under it`));
  row.dataset.ref = nodeRef(node);
  row.classList.toggle('selected', selection.has(nodeRef(node)));
  visible.push(nodeRef(node));
  row.onclick = e => {
    if (!clickSelects(e, node)) activate(t);
  };
  onRightClick(row, node);
  dragAndDrop(row, node);
  out.append(row);
  if (!isCollapsed) for (const c of node.children) renderNode(c, depth + 1, out);
}

// ---- search ----

// The text with every occurrence of the search words marked.
function marked(text, terms) {
  const frag = document.createDocumentFragment();
  const lower = text.toLowerCase();
  if (lower.length !== text.length) {
    frag.append(text);
    return frag;
  }
  let at = 0;
  for (;;) {
    let best = -1;
    let len = 0;
    for (const s of terms) {
      const i = lower.indexOf(s, at);
      if (i !== -1 && (best === -1 || i < best || (i === best && s.length > len))) {
        best = i;
        len = s.length;
      }
    }
    if (best === -1) break;
    if (best > at) frag.append(text.slice(at, best));
    frag.append(el('mark', null, text.slice(best, best + len)));
    at = best + len;
  }
  frag.append(text.slice(at));
  return frag;
}

function shortTitle(tab) {
  const { text } = cleanTitle(tab);
  return text.length > 30 ? `${text.slice(0, 29)}…` : text;
}

// Where a tab sits: the folders and the tickets or pages above it, top down, with the top-level folder's color.
function crumbs(t) {
  const box = el('span', 'crumbs');
  if (otherIds.has(t.id)) {
    box.append(icon('workspace', 'i s'), `Workspace ${t.workspaceName || ''} · opens there`);
    return box;
  }
  if (t.pinned) {
    box.append(icon('pin', 'i s'), 'Pinned');
    return box;
  }
  const parts = [];
  let color = null;
  for (let n = treeNodes.get(t.id)?.parent; n && !n.root; n = n.parent) {
    if (n.folder) {
      parts.unshift(n.folder.name);
      if (n.parent?.root) color = n.folder.color;
    } else {
      parts.unshift(n.ticket?.key ?? shortTitle(n.tab));
    }
  }
  if (color) box.append(colorSquare(color));
  if (!parts.length) box.append('Top level');
  parts.forEach((part, i) => {
    if (i) box.append(el('span', 'sep', ' › '));
    box.append(el('span', 'part', part));
  });
  return box;
}

// A search result: the row's text with the matches marked and, under it, where the tab sits in the tree.
function hitRow(t, terms) {
  const key = ticketKey(t) ?? undefined;
  const { text, kind, draft } = rowLabel(t, key, null);
  const row = el('div', 'row hit');
  row.classList.toggle('current', !!t.active && !otherIds.has(t.id));
  row.classList.toggle('discarded', !!t.discarded);
  const line = el('span', 'line');
  if (key) line.append(el('span', 'key', key));
  const title = el('span', 'title');
  title.append(marked(text, terms));
  line.append(title);
  if (kind) line.append(kindTag(kind));
  if (draft) line.append(el('span', 'badge draft', 'draft'));
  if (dupIds.has(t.id)) line.append(el('span', 'badge dup', 'dup'));
  if (otherIds.has(t.id)) line.append(el('span', 'badge ws', t.workspaceName || 'other workspace'));
  const body = el('span', 'body');
  body.append(line, crumbs(t));
  row.append(favicon(t), body);
  row.title = `${t.title}\n${t.url}`;
  row.onclick = () => activate(t);
  row.onmousedown = e => {
    if (e.button === 1) e.preventDefault();
  };
  row.onauxclick = e => {
    if (e.button === 1) chrome.tabs.remove(t.id);
  };
  const node = treeNodes.get(t.id);
  if (node) {
    row.dataset.ref = nodeRef(node);
    onRightClick(row, node);
  }
  return row;
}

function renderSearch(q, out) {
  const terms = q.split(/\s+/);
  hits = allTabs.filter(t => {
    const hay = `${t.title} ${t.url} ${ticketKey(t) ?? ''} ${kindLabel(t.url) ?? ''}`.toLowerCase();
    return terms.every(s => hay.includes(s));
  });
  selected = Math.max(0, Math.min(selected, hits.length - 1));
  if (!hits.length) {
    const clear = button('btn sm', 'Clear search', 'Clear the search (Esc)', clearSearch);
    clear.append(el('kbd', 'k', 'Esc'));
    out.append(emptyState('search', 'No tabs match',
      'Every word has to match a title, URL, ticket key or page kind: mr, pipeline, jira. All workspaces are searched.', clear));
    return;
  }
  const meta = el('div', 'meta');
  meta.append(el('span', null, plural(hits.length, 'tab')), el('span', null, '↑ ↓ move · ↵ open · Esc clear'));
  out.append(meta);
  hits.forEach((t, i) => {
    const row = hitRow(t, terms);
    if (i === selected) row.classList.add('hl');
    out.append(row);
  });
}

// ---- setup guide, empty states and settings ----

function emptyState(glyph, title, text, ...more) {
  const box = el('div', 'empty');
  const mark = el('span', 'glyph');
  mark.append(icon(glyph));
  box.append(mark, el('h4', null, title), el('p', null, text), ...more);
  return box;
}

// A button with an icon before its text.
function labelButton(cls, name, text, title, onClick) {
  const b = button(cls, text, title, onClick);
  b.prepend(icon(name));
  return b;
}

function guideCard() {
  const card = el('section', 'card guide');
  card.setAttribute('aria-label', 'Setup');
  card.append(el('h4', null, 'Set up TabTree'), el('p', null, 'Three things in Opera, once. Click a step to mark it done.'));
  const done = settings.setup ?? {};
  const steps = el('ol', 'steps');
  SETUP_STEPS.forEach(([id, name, text], i) => {
    const li = el('li', done[id] ? 'done' : null);
    li.dataset.step = id;
    const num = el('span', 'num', done[id] ? null : String(i + 1));
    if (done[id]) num.append(icon('done', 'i s'));
    const words = el('span');
    words.append(el('b', null, name), text);
    li.append(num, words);
    li.title = done[id] ? 'Mark as not done' : 'Mark as done';
    li.onclick = () => setSetting('setup', (setup = {}) => ({ ...setup, [id]: !setup[id] }));
    steps.append(li);
  });
  const actions = el('div', 'actions');
  actions.append(
    button('btn primary sm', 'Got it', "Don't show the guide again (Settings can bring it back)", () => {
      settings = { ...settings, onboarded: true };
      setSetting('onboarded', true);
      render();
    }),
    button('btn sm', 'Later', 'Hide the guide until the panel is opened again', () => {
      guideLater = true;
      render();
    }),
  );
  card.append(steps, actions);
  return card;
}

function showGuide() {
  guideLater = false;
  settings = { ...settings, onboarded: false };
  setSetting('onboarded', false);
  switchView('tree');
}

function renderSettings() {
  const out = el('div', 'settings');
  const section = name => out.append(el('div', 'sub', name));
  // A switch is named by a label, so that a click on the name flips it too.
  const option = (name, text, control, ...more) => {
    const opt = el('div', 'opt');
    const words = el('div', 'txt');
    const title = el(control.type === 'checkbox' ? 'label' : 'div');
    if (control.type === 'checkbox') title.htmlFor = control.id;
    title.append(el('b', null, name));
    words.append(title, el('p', null, text), ...more);
    opt.append(words, control);
    out.append(opt);
  };
  const toggleBox = (id, on, set) => {
    const box = el('input', 'switch');
    box.type = 'checkbox';
    box.id = id;
    box.checked = on;
    box.onchange = () => set(box.checked);
    return box;
  };

  section('Background');
  out.append(backgroundSettings());

  section('Tree');
  const keys = Object.keys(declined).sort();
  const chips = el('div', 'chips');
  chips.setAttribute('aria-label', 'Tickets that never get a folder');
  chips.append(el('span', 'muted', keys.length ? 'Never for' : 'No ticket is kept out of automatic folders.'));
  for (const key of keys) {
    const chip = el('span', 'chip', key);
    chip.dataset.key = key;
    const allow = button(null, null, `Allow a folder for ${key}`, () => send({ type: 'allowAutoFolder', key }));
    allow.setAttribute('aria-label', allow.title);
    allow.append(icon('close', 'i s'));
    chip.append(allow);
    chips.append(chip);
  }
  option('Auto-folders', 'A ticket family on the top level gets a folder of its own once it has a second tab.',
    toggleBox('set-auto-folders', settings.autoFolders !== false, on => setSetting('autoFolders', on)), chips);

  section('Opera');
  const mirrorOn = islandsOn();
  option('Islands', "Every top-level folder with two or more tabs is an island in Opera's tab strip. Changes made to islands in Opera are put back.",
    toggleBox('set-mirror', mirrorOn, on => setSetting('mirrorIslands', on)));
  const islands = el('ul', 'islands');
  for (const n of root.children.filter(c => c.folder)) {
    const count = tabIdsUnder(n).length;
    const state = !mirrorOn ? 'islands are off' : count >= 2 ? 'island' : count === 1 ? 'no island, Opera needs 2' : 'no island';
    const li = el('li', 'il');
    li.dataset.folder = n.folder.id;
    li.append(colorSquare(n.folder.color), el('span', 'grow', n.folder.name), el('span', 'm', `${plural(count, 'tab')} · ${state}`));
    islands.append(li);
  }
  if (!islands.childElementCount) islands.append(el('li', 'il m', 'No folders on the top level yet.'));
  out.append(islands);

  section('Statuses (probe)');
  out.append(sitesSettings());

  section('Diagnostics');
  option('Report', "Opera's version and APIs, counts, the snapshot and the last 60 events. Paste it into a session.",
    labelButton('btn sm', 'copy', 'Copy', 'Copy the report', copyReport));
  option('Log', 'The same report, live, with every event as it happens.',
    labelButton('btn sm', 'log', 'Open', 'Open the log', () => switchView('log')));

  section('Setup');
  option('Setup guide', "Pin the panel, collapse Opera's tab strip, turn off Opera's own Tab Islands.",
    button('btn sm', 'Show', 'Show the setup guide above the tree', showGuide));
  return out;
}

// ---- statuses: the probe ----
// Settings › Statuses lists the Jira, GitLab and Jenkins sites behind the open tabs. Connect asks Opera to let
// the extension request a site; Test asks the site's API, with the browser's session, who you are and about a
// page of the open tabs, from the background (where statuses would be fetched) and from this panel.

function sitesSettings() {
  const out = document.createDocumentFragment();
  out.append(el('div', 'wp-note', 'Can TabTree read the statuses of tickets and merge requests with your browser session, without tokens? Connect a site, then Test. Test only reads.'));
  const sites = detectSites(allTabs);
  if (sites.length) {
    const list = el('ul', 'sites');
    for (const site of sites) list.append(siteItem(site));
    out.append(list);
  }
  // Only the sites of open tabs are listed, so say how to bring in a missing one.
  const absent = Object.keys(KIND_NAMES).filter(kind => !sites.some(s => s.kind === kind));
  if (absent.length) {
    const names = absent.map(kind => KIND_NAMES[kind]).join(' or ');
    const pages = absent.map(kind => PAGE_TO_OPEN[kind]).join(' or ');
    out.append(el('div', 'wp-note', `No ${names} here: open ${pages}, and ${absent.length > 1 ? 'the site shows' : 'its site shows'} up.`));
  }
  return out;
}

function siteItem(site) {
  const li = el('li', 'site');
  li.dataset.site = site.base;
  const head = el('div', 'head');
  const name = el('span', 'grow', site.base.replace(/^https?:\/\//, ''));
  name.title = site.base;
  head.append(el('span', 'kind', KIND_NAMES[site.kind]), name);
  if (!granted.has(originPattern(site))) {
    head.append(button('btn sm primary', 'Connect', `Let TabTree request ${site.origin}`, () => connectSite(site)));
  } else {
    const busy = testing.has(site.base);
    const test = button('btn sm primary', busy ? 'Testing…' : 'Test', 'Ask the site who you are, and about a page of the open tabs', () => testSite(site));
    test.disabled = busy;
    head.append(test, button('btn sm', 'Disconnect', `Take back the access to ${site.origin}`, () => disconnectSite(site)));
  }
  const asks = [
    'who you are',
    site.keys.length && `${plural(site.keys.length, 'ticket')} of the open tabs`,
    site.mrs.length && 'a merge request and its approvals',
    site.pipelines.length && 'a pipeline',
    site.jobs.length && 'a job',
    site.builds.length && 'a build',
  ].filter(Boolean);
  const sampled = { jira: site.keys, gitlab: site.mrs, jenkins: site.builds }[site.kind].length > 0;
  li.append(head, el('div', 'm', `Asks for ${asks.join(', ')}.${sampled ? '' : ` Open ${PAGE_TO_OPEN[site.kind]} to try one too.`}`));
  if (apiProbe[site.base]) li.append(checkList('From the background', apiProbe[site.base]));
  if (panelProbes.has(site.base)) li.append(checkList('From this panel', panelProbes.get(site.base)));
  return li;
}

function checkList(title, entry) {
  const box = el('div', 'checks');
  box.append(el('div', 'ctx', `${title} · ${clock(entry.t)}`));
  const results = entry.error ? [{ name: 'No answer', ok: false, text: entry.error }] : entry.results;
  for (const { name, ok, text } of results) {
    const line = el('div', ok ? 'check' : 'check bad');
    line.append(icon(ok ? 'done' : 'close', 'i s'), el('b', null, name), el('span', null, text));
    box.append(line);
  }
  return box;
}

// Opera asks the user itself, and only for a request made right in the click, before anything is awaited.
function connectSite(site) {
  if (!chrome.permissions?.request) return toast('This panel has no permissions API', { error: true });
  chrome.permissions.request({ origins: [originPattern(site)] }).then(
    yes => {
      if (!yes) toast(`${hostOf(site.origin)}: access not given`, { error: true });
      refresh();
    },
    e => toast(`Connect failed: ${e.message}`, { error: true }),
  );
}

function disconnectSite(site) {
  chrome.permissions.remove({ origins: [originPattern(site)] }).then(refresh, e => toast(`Disconnect failed: ${e.message}`, { error: true }));
}

async function testSite(site) {
  testing.add(site.base);
  render();
  const [fromBackground, fromPanel] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'probeApi', site }).catch(e => ({ error: e.message })),
    probeSite(site).then(results => ({ t: Date.now(), results })),
  ]);
  const { ok, error, ...entry } = fromBackground ?? {};
  apiProbe = { ...apiProbe, [site.base]: ok ? entry : { t: Date.now(), error: error ?? 'no answer' } };
  panelProbes.set(site.base, fromPanel);
  testing.delete(site.base);
  render();
}

// For the report: each site with its checks, from the background and from this panel.
function probeLines() {
  const sites = new Map(detectSites(allTabs).map(s => [s.base, s]));
  for (const [base, entry] of Object.entries(apiProbe)) {
    if (!sites.has(base) && entry.kind) sites.set(base, { kind: entry.kind, origin: entry.origin, base });
  }
  const lines = [];
  for (const site of sites.values()) {
    lines.push(`- ${KIND_NAMES[site.kind]} ${site.base}: ${granted.has(originPattern(site)) ? 'connected' : 'not connected'}`);
    for (const [where, entry] of [['background', apiProbe[site.base]], ['panel', panelProbes.get(site.base)]]) {
      if (!entry) continue;
      const checks = entry.error ? `no answer: ${entry.error}` : entry.results.map(r => `${r.ok ? '✓' : '✗'} ${r.name}: ${r.text}`).join(' · ');
      lines.push(`  - ${where} ${clock(entry.t)}: ${checks}`);
    }
  }
  return lines;
}

// ---- the whole panel ----

function renderPinned() {
  pinnedEl.replaceChildren();
  if (view === 'tree') {
    for (const t of tabs.filter(t => t.pinned)) {
      const b = el('button', t.active ? 'pin on' : 'pin');
      b.title = t.audible ? `${t.title} · playing` : t.title;
      b.append(favicon(t));
      if (t.audible) b.append(el('span', 'snd'));
      b.onclick = () => activate(t);
      pinnedEl.append(b);
    }
  }
  pinnedEl.hidden = !pinnedEl.childElementCount;
}

// The status bar: the counts, then a square for each island (a click opens Settings).
function renderStats() {
  const keys = new Set(tabs.map(t => ticketKey(t)).filter(Boolean));
  const parts = [plural(tabs.length, 'tab'), plural(Object.keys(folders).length, 'folder'), plural(keys.size, 'ticket')];
  const elsewhere = new Map();
  for (const t of allTabs) {
    if (otherIds.has(t.id)) elsewhere.set(t.workspaceId, t.workspaceName || 'another workspace');
  }
  if (elsewhere.size === 1) parts.push(`+${otherIds.size} in ${[...elsewhere.values()][0]}`);
  else if (elsewhere.size > 1) parts.push(`+${otherIds.size} in ${elsewhere.size} workspaces`);
  statsEl.textContent = parts.join(' · ');
  statsEl.title = statsEl.textContent;
  const on = islandsOn();
  const islands = on ? root.children.filter(n => n.folder && tabIdsUnder(n).length >= 2) : [];
  islandsEl.hidden = on && !islands.length;
  islandsEl.replaceChildren(on ? 'Islands' : 'Islands off');
  for (const n of islands) {
    const sq = colorSquare(n.folder.color);
    sq.title = n.folder.name;
    islandsEl.append(sq);
  }
  islandsEl.title = on
    ? `${plural(islands.length, 'folder')} ${islands.length === 1 ? 'is an island' : 'are islands'} in Opera's tab strip`
    : "Islands are off: folders aren't mirrored in Opera's tab strip";
}

islandsEl.onclick = () => switchView('settings');

// Replaces what the list shows, keeping its scroll position and the control that had the focus.
function redraw(...content) {
  const scroll = listEl.scrollTop;
  const focused = listEl.contains(document.activeElement) ? document.activeElement.id : '';
  listEl.replaceChildren(...content);
  listEl.scrollTop = scroll;
  if (focused) document.getElementById(focused)?.focus();
}

function render() {
  if (paused || holding) {
    missed = true;
    return;
  }
  missed = false;
  const tree = buildTree(tabs.filter(t => !t.pinned), parents, folders, ranks);
  root = tree.root;
  treeNodes = tree.nodes;
  nodeByRef = new Map([...tree.nodes.values(), ...tree.folderNodes.values()].map(n => [nodeRef(n), n]));
  for (const ref of selection) if (!nodeByRef.has(ref)) selection.delete(ref);
  renderPinned();
  renderStats();
  // While the field holds text, ✕ takes the place of the / hint.
  $('#q-clear').hidden = !qEl.value;
  $('.search .k').hidden = !!qEl.value;
  if (view !== 'tree') {
    renderSelBar();
    return view === 'log' ? renderLog() : redraw(renderSettings());
  }
  const q = qEl.value.trim().toLowerCase();
  const out = document.createDocumentFragment();
  if (q) {
    renderSearch(q, out);
  } else {
    visible = [];
    rail = null;
    if (!settings.onboarded && !guideLater) out.append(guideCard());
    if (!root.children.length) {
      out.append(emptyState('emptyTree', 'No tabs in this workspace', 'Open a tab and it shows up here. A tab opened from another one hangs under it.',
        labelButton('btn sm', 'newFolder', 'New folder', 'New folder on the top level', () => addFolder(root))));
    }
    for (const n of root.children) renderNode(n, 0, out);
    const groups = otherWorkspaces();
    if (groups.length) out.append(el('div', 'section', 'Other workspaces'));
    for (const g of groups) renderGroup(g, 0, out);
  }
  renderSelBar();
  redraw(out);
  if (q) listEl.querySelector('.hl')?.scrollIntoView({ block: 'nearest' });
  const fresh = pendingRename && listEl.querySelector(`[data-folder="${pendingRename}"]`);
  if (fresh) {
    pendingRename = null;
    fresh.scrollIntoView({ block: 'nearest' });
    startRename(fresh, fresh.dataset.folder);
  }
}

// ---- log and report ----

function apiNames(o) {
  if (!o) return 'none';
  const names = new Set();
  for (let p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const n of Object.getOwnPropertyNames(p)) names.add(n);
  }
  names.delete('constructor');
  return [...names].sort().join(', ') || '(empty)';
}

const clock = t => new Date(t).toLocaleTimeString('en-GB', { hour12: false });

function fmtEvent(e) {
  const ts = clock(e.t);
  switch (e.ev) {
    case 'created':
      return `${ts} created #${e.id} idx=${e.index} opener=${e.opener ?? '—'}${e.openerHost ? ` (${e.openerHost})` : ''} group=${e.groupId ?? '—'}${e.active ? ' active' : ''} → ${e.host || '?'}`;
    case 'navTarget':
      return `${ts} navTarget #${e.id} source=#${e.source} (${e.sourceHost ?? '?'}) → ${e.host || '?'}`;
    case 'place':
      return `${ts} place ${e.node} under ${e.parent}`;
    case 'folder':
      return `${ts} folder ${e.action === 'auto' ? 'made automatically' : e.action} «${e.name}»`;
    case 'closed':
      return `${ts} closed a selection: ${e.tabs} tab(s), ${e.folders} folder(s)`;
    case 'mirror':
      return `${ts} mirror: ${e.islands} island(s), ${e.moved} tab(s) moved in, ${e.ungrouped} taken out`;
    case 'migrated':
      return `${ts} islands turned into ${e.folders} folder(s)`;
    case 'restored':
      return `${ts} restored the tree: ${e.matched} of ${e.saved} saved tabs matched, ${e.links} links`;
    case 'favicon':
    case 'title':
      return `${ts} ${e.ev} #${e.id} ${e.host}`;
    default:
      return `${ts} ${e.ev}: tabs=${e.tabs} withOpener=${e.withOpener} withGroup=${e.withGroup} discarded=${e.discarded}`;
  }
}

// What the report and the Log view are made of.
async function diagnostics() {
  const ua = navigator.userAgent;
  const count = f => allTabs.filter(f).length;
  const workspaces = new Map();
  for (const t of allTabs) workspaces.set(t.workspaceName ?? '(none)', (workspaces.get(t.workspaceName ?? '(none)') ?? 0) + 1);
  const { log = [], changes = [], snapshot } = await chrome.storage.local.get(['log', 'changes', 'snapshot']);
  const { mirror = {} } = await chrome.storage.session.get('mirror').catch(() => ({}));
  const byTime = (a, b) => a.t - b.t;
  return {
    opera: ua.match(/OPR\/([\d.]+)/)?.[1] ?? '?',
    chromium: ua.match(/Chrome\/([\d.]+)/)?.[1] ?? '?',
    platform: navigator.platform,
    count: {
      all: allTabs.length,
      pinned: count(t => t.pinned),
      active: count(t => t.active),
      discarded: count(t => t.discarded),
      island: count(t => (t.groupId ?? -1) !== -1),
    },
    workspaces: [...workspaces].map(([name, n]) => `«${name}» ${n}${name === (tabs[0]?.workspaceName ?? '(none)') ? ' (current)' : ''}`),
    islands: settings.mirrorIslands === false ? 'off' : Object.keys(mirror).length,
    placed: tabs.filter(t => parents[t.id] != null).length,
    keyed: tabs.filter(t => ticketKey(t)).length,
    keys: new Set(tabs.map(t => ticketKey(t)).filter(Boolean)).size,
    snapshot: snapshot
      ? `${snapshot.tabs.length} tabs, ${snapshot.tabs.filter(s => s.parent != null).length} placements, saved ${clock(snapshot.savedAt)}`
      : 'none yet',
    log: log.sort(byTime).slice(-60),
    changes: changes.sort(byTime).slice(-30),
  };
}

async function buildReport() {
  const d = await diagnostics();
  const yes = v => (v ? 'yes' : 'no');
  const c = d.count;
  const lines = [
    '## TabTrees probe',
    `- Opera ${d.opera}, Chromium ${d.chromium}, ${d.platform}`,
    `- opr: ${apiNames(globalThis.opr)}`,
    `- opr.sidebarAction: ${apiNames(globalThis.opr?.sidebarAction)}`,
    `- Tab fields: ${[...new Set(allTabs.flatMap(t => Object.keys(t)))].sort().join(', ')}`,
    `- chrome.sidebarAction: ${yes(chrome.sidebarAction)} · chrome.sidePanel: ${yes(chrome.sidePanel)} · chrome.tabGroups: ${yes(chrome.tabGroups)}`,
    `- Tabs in window: ${c.all} (pinned ${c.pinned}, active ${c.active}, discarded ${c.discarded}, in an island ${c.island}); lastAccessed: ${yes(allTabs.some(t => typeof t.lastAccessed === 'number'))}`,
    `- Workspaces: ${d.workspaces.join('; ')}`,
    `- Folders: ${Object.keys(folders).length}; mirrored as islands: ${d.islands}; ordered by hand: ${Object.keys(ranks).length}; kept out of automatic folders: ${Object.keys(declined).length}`,
    `- Tab placements: ${d.placed} of ${tabs.length} tabs; ticket keys: ${d.keyed} tabs, ${d.keys} distinct`,
    `- Snapshot for restarts: ${d.snapshot}`,
    `- Wallpaper: ${wallpaperLine()}`,
    `- Statuses probe: permissions API ${yes(chrome.permissions)}; connected: ${[...granted].join(', ') || 'none'}`,
  ];
  const probes = probeLines();
  if (probes.length) lines.push('', '### Statuses probe', ...probes);
  lines.push('', '### Events', '```', ...d.log.map(fmtEvent), '```');
  lines.push('', '### Background tab changes', '```', ...d.changes.map(fmtEvent), '```');
  return lines.join('\n');
}

// The Log view: the report's summary, then the events newest first, each tagged by its kind.
const EVENT_TAGS = {
  created: ['created', 'blue'], navTarget: ['link', 'blue'], place: ['place', 'purple'], folder: ['folder', 'yellow'],
  migrated: ['folder', 'yellow'], mirror: ['mirror', 'cyan'], closed: ['closed', 'red'], restored: ['restored', 'green'],
  title: ['title', 'grey'], favicon: ['favicon', 'grey'], installed: ['installed', 'grey'],
};
let logTab = 'events'; // or 'changes'

const code = text => el('code', null, String(text));

function eventWords(e) {
  switch (e.ev) {
    case 'created':
      return [code(`#${e.id}`), ...(e.opener != null ? [' from ', code(`#${e.opener}`), e.openerHost ? ` ${e.openerHost}` : ''] : []), ` → ${e.host || '?'}`];
    case 'navTarget':
      return [code(`#${e.id}`), ' from ', code(`#${e.source}`), ` ${e.sourceHost ?? '?'} → ${e.host || '?'}`];
    case 'place':
      return [code(e.node), ' under ', code(e.parent)];
    case 'folder':
      return [`${{ auto: 'made automatically', create: 'created', delete: 'deleted' }[e.action] ?? e.action} «${e.name}»`];
    case 'closed':
      return [`a selection: ${plural(e.tabs, 'tab')}, ${plural(e.folders, 'folder')}`];
    case 'mirror':
      return [`${plural(e.islands, 'island')}, ${plural(e.moved, 'tab')} moved in, ${e.ungrouped} taken out`];
    case 'migrated':
      return [`islands turned into ${plural(e.folders, 'folder')}`];
    case 'restored':
      return [`${e.matched} of ${e.saved} saved tabs matched, ${plural(e.links, 'link')}`];
    case 'favicon':
    case 'title':
      return [code(`#${e.id}`), ` ${e.host}`];
    default:
      return [`tabs=${e.tabs} withOpener=${e.withOpener} withGroup=${e.withGroup} discarded=${e.discarded}`];
  }
}

function eventRow(e) {
  const [tag, color] = EVENT_TAGS[e.ev] ?? ['startup', 'grey'];
  const row = el('div', 'ev');
  const text = el('p');
  text.append(...eventWords(e));
  row.append(el('time', null, clock(e.t)), el('span', `t c-${color}`, tag), text);
  return row;
}

function apiMark(name, ok) {
  const mark = el('span', ok ? 'api' : 'api no');
  mark.title = ok ? 'Available' : 'Missing';
  mark.append(icon(ok ? 'done' : 'close', 'i s'), name);
  return mark;
}

async function renderLog() {
  const d = await diagnostics();
  if (paused || view !== 'log') return;
  const c = d.count;
  const out = el('div', 'logv');
  const kv = el('dl', 'kv');
  const item = (name, ...value) => {
    const dd = el('dd');
    dd.append(...value);
    kv.append(el('dt', null, name), dd);
  };
  item('Opera', `${d.opera} · Chromium ${d.chromium} · ${d.platform}`);
  item('APIs', ...[
    ['opr.sidebarAction', globalThis.opr?.sidebarAction],
    ['chrome.tabGroups', chrome.tabGroups],
    ['chrome.sidePanel', chrome.sidePanel],
  ].map(([name, api]) => apiMark(name, !!api)));
  item('Tabs', `${c.all} in window · ${c.pinned} pinned · ${c.discarded} discarded · ${c.island} in islands`);
  item('Workspaces', d.workspaces.join(' · '));
  item('Folders', `${Object.keys(folders).length} · islands ${d.islands} · ordered by hand ${Object.keys(ranks).length}`);
  item('Placements', `${d.placed} of ${tabs.length} tabs · keys on ${d.keyed} tabs, ${d.keys} distinct`);
  item('Snapshot', d.snapshot);
  if (wallpaper) item('Wallpaper', wallpaperLine());
  const probed = Object.values(apiProbe).filter(p => p.results);
  item('Statuses', [
    `${plural(detectSites(allTabs).length, 'site')} in tabs · ${granted.size} connected`,
    ...probed.map(p => `${KIND_NAMES[p.kind]} ${p.results.filter(r => r.ok).length} of ${p.results.length} checks`),
  ].join(' · '));
  const seg = el('div', 'seg');
  seg.setAttribute('role', 'tablist');
  for (const [id, name, list, title] of [
    ['events', 'Events', d.log, 'The last 60 events'],
    ['changes', 'Background changes', d.changes, 'The last 30 title and favicon changes of tabs in the background'],
  ]) {
    const b = button(logTab === id ? 'on' : '', name, title, () => {
      logTab = id;
      render();
    });
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(logTab === id));
    b.append(el('span', 'n', String(list.length)));
    seg.append(b);
  }
  out.append(el('div', 'sub', 'This window'), kv, seg);
  const events = logTab === 'events' ? d.log : d.changes;
  for (const e of [...events].reverse()) out.append(eventRow(e));
  if (!events.length) out.append(el('div', 'note', 'Nothing yet.'));
  redraw(out);
}

// ---- toasts ----
// One message at a time, above the status bar: a confirmation for 2.5 s, or an error that stays longer and
// offers the report.

const toastsEl = $('#toasts');
let toastTimer = 0;

function toast(text, { error = false } = {}) {
  clearTimeout(toastTimer);
  const box = el('div', error ? 'toast err' : 'toast');
  box.setAttribute('role', error ? 'alert' : 'status');
  box.append(icon(error ? 'warning' : 'done'), el('span', 'grow', text));
  if (error) box.append(button('btn sm', 'Copy report', 'Copy the report, to paste into a session', copyReport));
  box.onclick = dismissToast;
  toastsEl.replaceChildren(box);
  toastTimer = setTimeout(dismissToast, error ? 8000 : 2500);
}

function dismissToast() {
  clearTimeout(toastTimer);
  toastsEl.replaceChildren();
}

async function copyReport() {
  const text = await buildReport();
  if (await writeClipboard(text)) toast('Report copied');
  else copyByHand(text);
}

// When the clipboard refuses, the Log view shows the report selected, to copy by hand; Esc goes back.
function copyByHand(text) {
  if (view !== 'log') switchView('log');
  paused = true;
  const banner = el('div', 'banner');
  const words = el('span');
  words.append('The clipboard refused. The report is selected: press ', el('b', null, 'Ctrl+C'), ', then ', el('b', null, 'Esc'), '.');
  banner.append(icon('warning'), words);
  const box = el('textarea', 'report');
  box.value = text;
  box.readOnly = true;
  box.setAttribute('aria-label', 'Report');
  listEl.replaceChildren(banner, box);
  box.focus();
  box.select();
}

$('#report').onclick = copyReport;

$('#new-folder').onclick = () => {
  if (!root) return;
  qEl.value = '';
  if (view !== 'tree') switchView('tree');
  addFolder(root);
};

// ---- wallpaper ----
// A picture behind the panel, from Settings › Background. It is kept with its settings under the storage key
// `wallpaper`, apart from `settings`, so that moving a slider redraws no tree; every panel (one per window)
// follows it. Its only source is an image file; `source` leaves room for Opera's own wallpaper, which needs a
// native helper.

const wallEl = $('#wall');
const scrimEl = $('#scrim');
const darkTheme = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
const WALL_TOKENS = ['--scrim', '--accent', '--accent-fg', '--accent-text', '--sel', '--sel-hover'];
const WALL_MAX = { height: 1400, width: 2800, bytes: 640_000 };
let wallpaper = null; // { source, name, dataUrl, width, height, w, h, bytes, tones, x, dim, blur, accent }
let wallWrites = 0; // writes of this panel still on their way to storage
let holding = false; // a slider or the frame is held: redraws wait, they would replace it

const shownWallpaper = () => (wallpaper?.source === 'file' && wallpaper.dataUrl ? wallpaper : null);

// The picture under everything, the scrim over it (Dim), the blur and the position; the accent tokens when the
// accent comes from the picture.
function applyWallpaper() {
  const w = shownWallpaper();
  document.body.classList.toggle('wp', !!w);
  wallEl.hidden = !w;
  scrimEl.hidden = !w;
  for (const name of WALL_TOKENS) document.body.style.removeProperty(name);
  if (!w) {
    wallEl.removeAttribute('src');
    return;
  }
  if (wallEl.getAttribute('src') !== w.dataUrl) wallEl.src = w.dataUrl;
  wallEl.style.setProperty('--x', `${w.x}%`);
  wallEl.style.setProperty('--blur', `${w.blur}px`);
  wallEl.classList.toggle('blur', w.blur > 0);
  const { '--dim': dim, '--dim-top': top, ...tokens } = wallTokens(w.tones, { dark: !!darkTheme?.matches, dim: w.dim / 100, accent: w.accent });
  scrimEl.style.setProperty('--dim', String(dim));
  scrimEl.style.setProperty('--dim-top', String(top));
  for (const [name, value] of Object.entries(tokens)) document.body.style.setProperty(name, value);
}

darkTheme?.addEventListener?.('change', () => {
  applyWallpaper();
  if (view === 'settings') render();
});

// Shows the wallpaper at once and stores it; null removes it.
function saveWallpaper(next) {
  wallpaper = next;
  applyWallpaper();
  wallWrites++;
  const writing = next ? chrome.storage.local.set({ wallpaper: next }) : chrome.storage.local.remove('wallpaper');
  return writing
    .catch(e => toast(`The picture wasn't saved: ${e.message}`, { error: true }))
    .finally(() => wallWrites--);
}

// Takes up what another panel stored; this panel's own writes are already shown.
async function loadWallpaper() {
  const { wallpaper: stored = null } = await chrome.storage.local.get('wallpaper');
  if (wallWrites || JSON.stringify(stored) === JSON.stringify(wallpaper)) return;
  wallpaper = stored;
  applyWallpaper();
  if (view === 'settings') render();
}

const bytesOf = dataUrl => Math.round(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

// Scales the picture down to at most 1400px tall (it covers the panel's height) and stores it as a JPEG of about
// half a megabyte: quality 0.85, or less for a busy picture. Its colors are sampled at 64×36.
async function readImage(file) {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, WALL_MAX.height / height, WALL_MAX.width / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let dataUrl = '';
  for (const quality of [0.85, 0.78, 0.7, 0.62]) {
    dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (bytesOf(dataUrl) <= WALL_MAX.bytes) break;
  }
  const sample = document.createElement('canvas');
  sample.width = 64;
  sample.height = 36;
  const sampleCtx = sample.getContext('2d');
  sampleCtx.drawImage(canvas, 0, 0, 64, 36);
  const tones = tonesOf(sampleCtx.getImageData(0, 0, 64, 36).data);
  return { dataUrl, width, height, w: canvas.width, h: canvas.height, bytes: bytesOf(dataUrl), tones };
}

async function useImage(file) {
  try {
    const picture = await readImage(file);
    const kept = wallpaper ?? {};
    await saveWallpaper({
      source: 'file',
      name: file.name,
      ...picture,
      x: 50,
      dim: kept.dim ?? 70,
      blur: kept.blur ?? 0,
      accent: kept.accent ?? 'wallpaper',
    });
    render();
  } catch (e) {
    toast(`This picture can't be used: ${e.message}`, { error: true });
  }
}

const pickImage = () => $('#wp-input').click();
$('#wp-input').onchange = e => {
  const [file] = e.target.files ?? [];
  e.target.value = '';
  if (file) useImage(file);
};

// While the pointer holds a slider or the frame, redraws wait; `done` runs when it lets go.
function hold(done) {
  holding = true;
  const events = ['pointerup', 'pointercancel', 'blur'];
  const release = e => {
    // Only the window's own blur: the pointer may never come back up in it.
    if (e.type === 'blur' && e.target !== window) return;
    for (const type of events) window.removeEventListener(type, release, true);
    holding = false;
    done?.();
    // Later than the pointer's own handlers: a slider stores its value on the change event that follows.
    setTimeout(() => {
      if (missed) render();
    });
  };
  for (const type of events) window.addEventListener(type, release, true);
}

function adjustWallpaper(name, value, save) {
  wallpaper = { ...wallpaper, [name]: value };
  if (save) saveWallpaper(wallpaper);
  else applyWallpaper();
}

// The share of the picture's width that the panel shows: the picture covers the panel's full height.
function visibleShare(w) {
  const panel = (document.documentElement.clientWidth || 380) / (document.documentElement.clientHeight || 900);
  return Math.min(1, panel / (w.w / w.h));
}

// The whole picture with a frame over the part behind the panel; drag the frame (or use ← →) to move it.
function wallSlice(w) {
  const box = el('div', 'slice');
  const img = el('img');
  img.src = w.dataUrl;
  img.alt = 'The whole picture';
  const frame = el('span', 'win');
  frame.id = 'wp-frame';
  frame.tabIndex = 0;
  frame.setAttribute('role', 'slider');
  frame.setAttribute('aria-label', 'The part of the picture behind the panel');
  frame.setAttribute('aria-valuemin', '0');
  frame.setAttribute('aria-valuemax', '100');
  const share = visibleShare(w);
  const place = () => {
    frame.style.width = `${share * 100}%`;
    frame.style.left = `${(1 - share) * wallpaper.x}%`;
    frame.setAttribute('aria-valuenow', String(wallpaper.x));
  };
  const moveTo = e => {
    const r = box.getBoundingClientRect();
    if (!r.width || share >= 1) return;
    const left = (e.clientX - (r.left ?? 0)) / r.width - share / 2;
    adjustWallpaper('x', Math.round(Math.min(1, Math.max(0, left / (1 - share))) * 100), false);
    place();
  };
  box.addEventListener('pointerdown', e => {
    e.preventDefault();
    frame.focus();
    moveTo(e);
    hold(() => saveWallpaper(wallpaper));
  });
  box.addEventListener('pointermove', e => {
    if (holding) moveTo(e);
  });
  frame.onkeydown = e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    adjustWallpaper('x', Math.min(100, Math.max(0, wallpaper.x + (e.key === 'ArrowRight' ? 5 : -5))), true);
    place();
  };
  place();
  box.append(img, frame);
  return box;
}

function wallSlider(id, name, max, unit, key) {
  const box = el('div', 'slider');
  const head = el('div');
  const label = el('label', null, name);
  label.htmlFor = id;
  const shown = el('span', null, `${wallpaper[key]}${unit}`);
  head.append(label, shown);
  const input = el('input', 'range');
  input.type = 'range';
  input.id = id;
  input.min = '0';
  input.max = String(max);
  input.value = String(wallpaper[key]);
  input.addEventListener('pointerdown', () => hold());
  input.oninput = () => {
    shown.textContent = `${input.value}${unit}`;
    adjustWallpaper(key, Number(input.value), false);
  };
  input.onchange = () => adjustWallpaper(key, Number(input.value), true);
  box.append(head, input);
  return box;
}

function accentChoice(w) {
  const box = el('div', 'accent-pick');
  const list = el('div', 'accents');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', 'Accent color');
  const dark = !!darkTheme?.matches;
  const own = wallTokens(w.tones, { dark, dim: w.dim / 100, accent: 'wallpaper' })['--accent'];
  for (const [id, text, color] of [['blue', 'Blue', dark ? '#78a6ff' : '#2f6feb'], ['wallpaper', 'From wallpaper', own]]) {
    const on = w.accent === id;
    const b = button(on ? 'acc on' : 'acc', null, own || id === 'blue' ? `Accent: ${text}` : 'The picture has no color strong enough', () => {
      saveWallpaper({ ...wallpaper, accent: id });
      render();
    });
    b.dataset.accent = id;
    b.disabled = !color;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    const swatch = el('span', 'sq');
    if (color) swatch.style.background = color;
    b.append(swatch, text);
    list.append(b);
  }
  box.append(el('b', null, 'Accent'), list);
  return box;
}

// Settings › Background: None or an image file; with a picture, its part behind the panel, Dim, Blur and the
// accent.
function backgroundSettings() {
  const out = document.createDocumentFragment();
  const file = wallpaper?.dataUrl ? wallpaper : null;
  const shown = shownWallpaper();
  const seg = el('div', 'seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Background');
  const choice = (id, text, on, title, run) => {
    const b = button(on ? 'on' : '', text, title, run);
    b.id = id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    seg.append(b);
  };
  choice('wp-none', 'None', !shown, 'No picture behind the tree', () => {
    if (!shown) return;
    saveWallpaper({ ...shown, source: 'none' });
    render();
  });
  choice('wp-file', 'Image file', !!shown, file ? 'The picture picked before' : 'Pick a picture', () => {
    if (shown) return;
    if (!file) return pickImage();
    saveWallpaper({ ...file, source: 'file' });
    render();
  });
  out.append(seg);
  if (!shown) {
    out.append(el('div', 'wp-note', file ? `${file.name} is kept: Image file shows it again.` : 'Image file puts a picture of yours behind the tree.'));
    return out;
  }
  const name = el('div', 'wp-name');
  name.append(
    el('span', null, `${shown.name} · ${shown.w}×${shown.h}`),
    button('btn sm', 'Change…', 'Pick another picture', pickImage),
    button('btn sm', 'Remove', 'Remove the picture', () => {
      saveWallpaper(null);
      render();
    }),
  );
  out.append(
    wallSlice(shown),
    el('div', 'wp-note', 'Drag the frame to pick the part behind the panel.'),
    name,
    wallSlider('wp-dim', 'Dim', 100, '%', 'dim'),
    wallSlider('wp-blur', 'Blur', 24, ' px', 'blur'),
    accentChoice(shown),
  );
  return out;
}

// For the report: "image 2560×1440 → 2489×1400, 612 KB, x 12, dim 70, blur 0, accent #ee94c6".
function wallpaperLine() {
  const w = wallpaper;
  if (!w?.dataUrl) return 'none';
  const own = wallTokens(w.tones, { dark: !!darkTheme?.matches, dim: w.dim / 100, accent: w.accent })['--accent'];
  const source = w.source === 'file' ? 'image' : 'none, an image is kept:';
  return `${source} ${w.width}×${w.height} → ${w.w}×${w.h}, ${Math.round(w.bytes / 1024)} KB, x ${w.x}, dim ${w.dim}, blur ${w.blur}, accent ${own ?? 'blue'}`;
}

// ---- wiring ----

// The tree has the search header; Log and Settings have a bar with ← and their title.
function showView() {
  document.body.dataset.view = view;
  $('#hdr').hidden = view !== 'tree';
  $('#vbar').hidden = view === 'tree';
  $('#view-title').textContent = { log: 'Log', settings: 'Settings' }[view] ?? '';
  $('#report').hidden = view !== 'log';
}

function switchView(next) {
  view = next;
  if (next !== 'settings') prefs.set('view', next);
  showView();
  closeMenu();
  paused = false;
  render();
}

showView();
$('#open-log').onclick = () => switchView('log');
$('#open-settings').onclick = () => switchView('settings');
$('#back').onclick = () => switchView('tree');

function clearSearch() {
  qEl.value = '';
  selected = 0;
  render();
  qEl.focus();
}

$('#q-clear').onclick = clearSearch;
qEl.addEventListener('input', () => {
  selected = 0;
  render();
});
qEl.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    selected += e.key === 'ArrowDown' ? 1 : -1;
    render();
  } else if (e.key === 'Enter' && qEl.value.trim() && hits[selected]) {
    activate(hits[selected]);
  }
});
document.addEventListener('keydown', e => {
  // While a menu is open, keys belong to it: Esc closes it, and nothing else reaches the tree.
  if (!menuEl.hidden) {
    if (e.key === 'Escape') closeMenu();
    return;
  }
  if (e.key === 'Escape' && armed) {
    disarm();
  } else if (e.key === 'Escape') {
    paused = false;
    qEl.value = '';
    selection.clear();
    anchor = null;
    if (view !== 'tree') switchView('tree');
    else render();
  } else if (e.key === 'Delete' && view === 'tree' && selection.size && document.activeElement !== qEl) {
    $('#sel-close').click();
  } else if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) {
    e.preventDefault();
    if (view !== 'tree') switchView('tree');
    qEl.focus();
  }
});

let timer = 0;
function refresh() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await load();
    render();
  }, 120);
}

for (const name of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onActivated', 'onAttached', 'onDetached', 'onReplaced']) {
  chrome.tabs[name]?.addListener(refresh);
}
chrome.permissions?.onAdded?.addListener(refresh);
chrome.permissions?.onRemoved?.addListener(refresh);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('wallpaper' in changes) loadWallpaper();
  if (['parents', 'folders', 'ranks', 'settings', 'declined'].some(k => k in changes)) refresh();
  else if (view === 'log') render();
});

loadWallpaper();
refresh();
