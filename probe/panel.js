import { ticketKey, cleanTitle, rowLabel, kindLabel, hostOf, urlKey, islandName, colorFor } from './titles.js';
import { buildTree, tabIdsUnder, nodeRef, folderRef } from './tree.js';

const $ = sel => document.querySelector(sel);
const listEl = $('#list');
const pinnedEl = $('#pinned');
const statsEl = $('#stats');
const qEl = $('#q');
const selBar = $('#selbar');

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

// Chromium tab group colors, which folders share with the islands that mirror them.
const GROUP_COLORS = {
  grey: '#9aa0a6', blue: '#8ab4f8', red: '#f28b82', yellow: '#fdd663', green: '#81c995',
  pink: '#ff8bcb', purple: '#c58af9', cyan: '#78d9ec', orange: '#fcad70',
};
const COLORS = Object.keys(GROUP_COLORS);

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

async function load() {
  let list = await chrome.tabs.query({ currentWindow: true });
  if (!list.length) list = await chrome.tabs.query({ lastFocusedWindow: true });
  allTabs = list.sort((a, b) => a.index - b.index);
  const { current, others } = splitWorkspaces(allTabs);
  tabs = current;
  otherIds = new Set(others.map(t => t.id));
  dupIds = findDuplicates(tabs);
  const stored = await chrome.storage.local.get(['parents', 'folders', 'ranks', 'settings', 'declined']);
  parents = stored.parents ?? {};
  folders = stored.folders ?? {};
  ranks = stored.ranks ?? {};
  settings = stored.settings ?? {};
  declined = stored.declined ?? {};
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
  if (!res?.ok) flash(`${msg.type} failed: ${res?.error ?? 'no answer'}`);
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

function copyText(text, done) {
  const writing = navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'));
  writing.then(() => flash(done), () => flash('The clipboard refused'));
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

function describe(nodes) {
  const tabCount = new Set(nodes.flatMap(tabIdsUnder)).size;
  const folderCount = nodes.flatMap(foldersUnder).length;
  return [tabCount && plural(tabCount, 'tab'), folderCount && plural(folderCount, 'folder')].filter(Boolean).join(', ');
}

function closeSelection() {
  const nodes = selectedNodes();
  send({ type: 'closeItems', tabIds: [...new Set(nodes.flatMap(tabIdsUnder))], folderIds: nodes.flatMap(foldersUnder) });
  selection.clear();
  anchor = null;
  render();
}

function selectionToFolder() {
  const nodes = selectedNodes();
  selection.clear();
  anchor = null;
  nodesToFolder(nodes);
  render();
}

function renderSelBar() {
  const nodes = selectedNodes();
  selBar.hidden = !nodes.length || view !== 'tree';
  if (selBar.hidden) return;
  const what = describe(nodes);
  $('#sel-count').textContent = `${selection.size} selected: ${what || 'nothing'}`;
  $('#sel-close').textContent = armed ? `Sure? Close ${what}` : 'Close';
  $('#sel-close').classList.toggle('armed', !!armed);
}

$('#sel-folder').onclick = selectionToFolder;
$('#sel-clear').onclick = forgetSelection;
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
  clearTimeout(armed);
  armed = 0;
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

// Items are { label, hint, danger, run }, { colors: current, run(color) }, or '-' between groups; falsy
// items are left out. `at` is where to open: a point, or the right edge of the ⋯ button (alignRight).
function openMenu(items, at) {
  paused = true;
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
  paused = false;
  if (missed) refresh();
}

function menuItem({ label, hint, danger, run }) {
  const b = el('button', danger ? 'mi danger' : 'mi');
  b.setAttribute('role', 'menuitem');
  b.append(el('span', 'label', label));
  if (hint) b.append(el('small', 'hint', hint));
  b.onclick = () => {
    closeMenu();
    run();
  };
  return b;
}

function swatches({ colors: current, run }) {
  const box = el('div', 'swatches');
  box.setAttribute('role', 'radiogroup');
  box.setAttribute('aria-label', 'Folder color');
  for (const color of COLORS) {
    const b = el('button', color === current ? 'sw on' : 'sw');
    b.style.background = GROUP_COLORS[color];
    b.title = color[0].toUpperCase() + color.slice(1);
    b.dataset.color = color;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(color === current));
    b.onclick = () => {
      closeMenu();
      run(color);
    };
    box.append(b);
  }
  return box;
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
    { label: 'New folder inside', run: () => addFolder(node) },
    {
      label: 'Rename',
      run: () => {
        pendingRename = f.id;
        render();
      },
    },
    { colors: f.color, run: color => send({ type: 'colorFolder', id: f.id, color }) },
    dups.length > 0 && { label: `Close ${plural(dups.length, 'duplicate')}`, run: () => chrome.tabs.remove(dups) },
    ids.length > 0 && { label: 'Copy links as Markdown', run: () => copyText(markdownOf([node]), 'Links copied') },
    '-',
    { label: 'Delete folder', hint: 'Its tabs move one level up', danger: true, run: () => send({ type: 'deleteFolder', id: f.id }) },
  ];
}

function tabMenu(node) {
  const t = node.tab;
  const branch = tabIdsUnder(node);
  const many = branch.length > 1;
  // A ticket's own page moves with its ticket, as it does when dragged.
  const unit = node.groupKey ? node.parent : node;
  return [
    { label: 'Close tab', hint: 'Middle click', run: () => chrome.tabs.remove(t.id) },
    many && { label: `Close ${branch.length} tabs`, hint: 'This tab and everything under it', run: () => chrome.tabs.remove(branch) },
    '-',
    { label: 'Put into a new folder', run: () => nodesToFolder([unit], unit.ticket ? ticketFolder(unit) : {}) },
    !unit.parent?.root && { label: 'Move to the top level', run: () => moveToTop([unit]) },
    '-',
    { label: 'Copy link', run: () => copyText(t.url, 'Link copied') },
    many && { label: 'Copy links as Markdown', run: () => copyText(markdownOf([node]), 'Links copied') },
    '-',
    { label: many ? `Reload ${branch.length} tabs` : 'Reload', run: () => reload(branch) },
    { label: many ? `Unload ${branch.length} tabs` : 'Unload from memory', hint: 'Loads again when opened', run: () => unload(branch) },
  ];
}

function selectionMenu() {
  const nodes = selectedNodes();
  const ids = [...new Set(nodes.flatMap(tabIdsUnder))];
  return [
    { label: `Put ${plural(nodes.length, 'item')} into a new folder`, run: selectionToFolder },
    nodes.some(n => !n.parent?.root) && { label: 'Move to the top level', run: () => moveToTop(nodes) },
    ids.length > 0 && { label: 'Copy links as Markdown', run: () => copyText(markdownOf(nodes), 'Links copied') },
    '-',
    ids.length > 0 && { label: `Reload ${plural(ids.length, 'tab')}`, run: () => reload(ids) },
    ids.length > 0 && { label: `Unload ${plural(ids.length, 'tab')}`, run: () => unload(ids) },
    '-',
    { label: `Close ${describe(nodes)}`, danger: true, run: closeSelection },
  ];
}

function moreButton(node) {
  const b = el('button', 'badge on-hover more', '⋯');
  b.title = 'More actions (right click)';
  b.setAttribute('aria-label', 'More actions');
  b.onclick = e => {
    e.stopPropagation();
    const r = b.getBoundingClientRect();
    openMenu(menuFor(node), { x: r.right, y: (r.bottom ?? 0) + 2, above: (r.top ?? 0) - 2, alignRight: true });
  };
  return b;
}

const onRightClick = (row, node) => {
  row.oncontextmenu = e => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(menuFor(node), { x: e.clientX, y: e.clientY });
  };
};

listEl.addEventListener('contextmenu', e => {
  if (e.target !== listEl || view !== 'tree' || qEl.value.trim()) return;
  e.preventDefault();
  openMenu([{ label: 'New folder', run: () => addFolder(root) }], { x: e.clientX, y: e.clientY });
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
  row.querySelector('.title').replaceWith(input);
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

function withOtherWorkspaces(roots) {
  const byWs = new Map();
  for (const t of allTabs) {
    if (!otherIds.has(t.id)) continue;
    if (!byWs.has(t.workspaceId)) byWs.set(t.workspaceId, { name: t.workspaceName, list: [] });
    byWs.get(t.workspaceId).list.push(t);
  }
  const extra = [...byWs].map(([ws, { name, list }]) => ({
    group: { id: `ws:${ws}`, title: `Workspace: ${name || ws}`, defaultCollapsed: true },
    children: list.map(t => ({ tab: t, children: [] })),
  }));
  return [...roots, ...extra];
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
const topZone = el('div', 'drop-zone', 'Drop here: last on the top level');

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
    row.classList.add('dragging');
    listEl.append(topZone);
  };
  row.ondragend = () => {
    drag = null;
    topZone.remove();
    paused = false;
    refresh();
  };
  const clear = () => row.classList.remove('drop-before', 'drop-after', 'drop-inside');
  row.ondragover = e => {
    if (!drag) return;
    const zone = zoneOf(e, row);
    clear();
    if (!placement(node, zone)) return;
    e.preventDefault();
    e.stopPropagation();
    row.classList.add(`drop-${zone}`);
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

const pad = depth => `${4 + depth * 14}px`;
const activate = t => chrome.tabs.update(t.id, { active: true });
const nextColor = color => COLORS[(COLORS.indexOf(color) + 1) % COLORS.length];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function button(cls, text, title, onClick) {
  const b = el('button', cls, text);
  b.title = title;
  b.onclick = e => {
    e.stopPropagation();
    onClick();
  };
  return b;
}

function colorDot(color) {
  const dot = el('span', 'dot');
  dot.style.background = GROUP_COLORS[color] || color;
  return dot;
}

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

function dupButton(ids) {
  const dups = ids.filter(tid => dupIds.has(tid));
  if (!dups.length) return [];
  const label = `✕ ${dups.length} dup${dups.length === 1 ? '' : 's'}`;
  return [button('badge dup', label, 'Close extra copies, keep the active or most recently used one', () => chrome.tabs.remove(dups))];
}

function tabRow(t, depth, { twisty = '', onTwisty, key, label } = {}) {
  const row = el('div', 'row');
  row.classList.toggle('active', t.active);
  row.classList.toggle('discarded', !!t.discarded);
  row.style.paddingLeft = pad(depth);
  const tw = el('span', 'twisty', twisty);
  if (onTwisty) {
    tw.onclick = e => {
      e.stopPropagation();
      onTwisty();
    };
  }
  row.append(tw, favicon(t));
  if (key) row.append(el('span', 'key', key));
  const { text, kind, draft } = label || { ...cleanTitle(t, key), kind: null };
  row.append(el('span', 'title', text));
  if (kind) row.append(el('span', 'badge', kind));
  if (draft) row.append(el('span', 'badge', 'draft'));
  if (dupIds.has(t.id)) row.append(el('span', 'badge dup', 'dup'));
  if (t.audible) row.append(el('span', 'badge', '♪'));
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

function renderFolder(node, depth, out) {
  const f = node.folder;
  const id = `${view}:${nodeRef(node)}`;
  const isCollapsed = collapsed.has(id);
  const row = el('div', 'row group folder');
  row.dataset.folder = f.id;
  row.classList.toggle('selected', selection.has(nodeRef(node)));
  visible.push(nodeRef(node));
  row.style.paddingLeft = pad(depth);
  row.append(el('span', 'twisty', node.children.length ? (isCollapsed ? '▸' : '▾') : ''));
  const dot = colorDot(f.color);
  dot.title = 'Change color';
  dot.onclick = e => {
    e.stopPropagation();
    send({ type: 'colorFolder', id: f.id, color: nextColor(f.color) });
  };
  const ids = tabIdsUnder(node);
  row.append(
    dot,
    el('span', 'title', f.name),
    ...dupButton(ids),
    button('badge on-hover', '+', 'New folder inside', () => addFolder(node)),
    moreButton(node),
    el('span', 'count', String(ids.length)),
  );
  row.onclick = e => {
    if (!clickSelects(e, node)) toggle(id);
  };
  onRightClick(row, node);
  dragAndDrop(row, node);
  out.append(row);
  if (!isCollapsed) for (const c of node.children) renderNode(c, depth + 1, out);
}

// The other workspaces' tabs: a plain list, nothing to drag.
function renderGroup(node, depth, out) {
  const g = node.group;
  const id = `${view}:${g.id}`;
  // For groups that start collapsed the set remembers the opposite state.
  const isCollapsed = g.defaultCollapsed ? !collapsed.has(id) : collapsed.has(id);
  const row = el('div', 'row group');
  row.style.paddingLeft = pad(depth);
  row.append(el('span', 'twisty', isCollapsed ? '▸' : '▾'), el('span', 'title', g.title));
  row.append(el('span', 'count', String(node.children.length)));
  row.onclick = () => toggle(id);
  out.append(row);
  if (!isCollapsed) for (const c of node.children) out.append(tabRow(c.tab, depth + 1));
}

function renderNode(node, depth, out) {
  if (node.folder) return renderFolder(node, depth, out);
  if (node.group) return renderGroup(node, depth, out);
  const t = node.tab;
  const id = `${view}:${nodeRef(node)}`;
  const hasKids = node.children.length > 0;
  const isCollapsed = hasKids && collapsed.has(id);
  const { ticket } = node;
  let label;
  if (ticket) label = rowLabel(t, ticket.key, null);
  else if (node.groupKey) label = rowLabel(t, node.groupKey, node.groupTitle);
  const row = tabRow(t, depth, {
    twisty: hasKids ? (isCollapsed ? '▸' : '▾') : '',
    onTwisty: hasKids ? () => toggle(id) : undefined,
    key: ticket?.key,
    label,
  });
  const branch = tabIdsUnder(node);
  if (isCollapsed) row.append(el('span', 'count', `+${branch.length - 1}`));
  if (ticket && node.parent?.root) {
    row.append(button('badge on-hover', '→ folder', `Put ${ticket.key} and everything under it into a new folder`, () => familyToFolder(node)));
  }
  row.append(button('badge on-hover close', '✕', 'Close tab (middle click)', () => chrome.tabs.remove(t.id)), moreButton(node));
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

// Where a tab sits: the folders and the tickets or pages above it, top down.
function crumbs(t) {
  const box = el('span', 'crumbs');
  if (otherIds.has(t.id)) {
    box.textContent = `Workspace ${t.workspaceName || ''} · opens there`;
    return box;
  }
  if (t.pinned) {
    box.textContent = 'Pinned';
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
  if (color) box.append(colorDot(color));
  box.append(parts.length ? parts.join(' › ') : 'Top level');
  return box;
}

// A search result: the row's text with the matches marked and, under it, where the tab sits in the tree.
function hitRow(t, terms) {
  const key = ticketKey(t) ?? undefined;
  const { text, kind, draft } = rowLabel(t, key, null);
  const row = el('div', 'row hit');
  row.classList.toggle('active', t.active);
  row.classList.toggle('discarded', !!t.discarded);
  const line = el('span', 'line');
  if (key) line.append(el('span', 'key', key));
  const title = el('span', 'title');
  title.append(marked(text, terms));
  line.append(title);
  if (kind) line.append(el('span', 'badge', kind));
  if (draft) line.append(el('span', 'badge', 'draft'));
  if (dupIds.has(t.id)) line.append(el('span', 'badge dup', 'dup'));
  if (otherIds.has(t.id)) line.append(el('span', 'badge', t.workspaceName || 'other workspace'));
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
  if (node) onRightClick(row, node);
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
    out.append(el('div', 'note', 'No tabs match. Every word has to match a title, URL, ticket key or page kind (mr, pipeline, jira); all workspaces are searched.'));
    return;
  }
  out.append(el('div', 'meta', `${plural(hits.length, 'tab')} · ↑ ↓ move · Enter opens · Esc clears`));
  hits.forEach((t, i) => {
    const row = hitRow(t, terms);
    if (i === selected) row.classList.add('sel');
    out.append(row);
  });
}

// ---- setup guide and settings ----

function guideCard() {
  const card = el('section', 'card guide');
  card.setAttribute('aria-label', 'Setup');
  card.append(el('h4', null, 'Set up TabTree'), el('p', null, 'Three things in Opera, once. Click a step to mark it done.'));
  const done = settings.setup ?? {};
  const steps = el('ol', 'steps');
  SETUP_STEPS.forEach(([id, name, text], i) => {
    const li = el('li');
    li.dataset.step = id;
    li.classList.toggle('done', !!done[id]);
    const words = el('span');
    words.append(el('b', null, name), el('span', 'muted', text));
    li.append(el('span', 'num', done[id] ? '✓' : String(i + 1)), words);
    li.title = done[id] ? 'Mark as not done' : 'Mark as done';
    li.onclick = () => setSetting('setup', (setup = {}) => ({ ...setup, [id]: !setup[id] }));
    steps.append(li);
  });
  const actions = el('div', 'actions');
  actions.append(
    button('btn primary', 'Got it', "Don't show the guide again (Settings can bring it back)", () => {
      settings = { ...settings, onboarded: true };
      setSetting('onboarded', true);
      render();
    }),
    button('btn', 'Later', 'Hide the guide until the panel is opened again', () => {
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
  const section = name => out.append(el('h3', null, name));
  const option = (name, text, control) => {
    const opt = el('div', 'opt');
    const words = el('div', 'txt');
    words.append(el('b', null, name), el('p', null, text));
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

  section('Tree');
  option('Auto-folders', 'A ticket family on the top level gets a folder of its own once it has a second tab.',
    toggleBox('set-auto-folders', settings.autoFolders !== false, on => setSetting('autoFolders', on)));
  const keys = Object.keys(declined).sort();
  const chips = el('div', 'chips');
  chips.append(el('span', 'muted', keys.length ? 'Never for' : 'No ticket is kept out of automatic folders.'));
  for (const key of keys) {
    const chip = el('span', 'chip', key);
    chip.dataset.key = key;
    chip.append(button('chip-x', '✕', `Allow a folder for ${key}`, () => send({ type: 'allowAutoFolder', key })));
    chips.append(chip);
  }
  out.append(chips);

  section('Opera');
  const mirrorOn = !!chrome.tabGroups && settings.mirrorIslands !== false;
  option('Islands', "Every top-level folder with two or more tabs is an island in Opera's tab strip. Changes made to islands in Opera are put back.",
    toggleBox('set-mirror', mirrorOn, on => setSetting('mirrorIslands', on)));
  const islands = el('ul', 'islands');
  for (const n of root.children.filter(c => c.folder)) {
    const count = tabIdsUnder(n).length;
    const state = !mirrorOn ? 'islands are off' : count >= 2 ? 'island' : count === 1 ? 'no island, Opera needs 2' : 'no island';
    const li = el('li');
    li.dataset.folder = n.folder.id;
    li.append(colorDot(n.folder.color), el('span', 'title', n.folder.name), el('span', 'count', `${plural(count, 'tab')} · ${state}`));
    islands.append(li);
  }
  if (!islands.childElementCount) islands.append(el('li', 'muted', 'No folders on the top level yet.'));
  out.append(islands);

  section('Diagnostics');
  option('Report', "Opera's version and APIs, counts, the snapshot and the last 60 events. Paste it into a session.",
    button('btn', 'Copy', 'Copy the report', copyReport));
  option('Log', 'The same report, live.', button('btn', 'Open', 'Open the log', () => switchView('log')));

  section('Setup');
  option('Setup guide', "Pin the panel, collapse Opera's tab strip, turn off Opera's own Tab Islands.",
    button('btn', 'Show', 'Show the setup guide above the tree', showGuide));
  listEl.replaceChildren(out);
}

// ---- the whole panel ----

function renderPinned() {
  pinnedEl.replaceChildren();
  if (view === 'tree') {
    for (const t of tabs.filter(t => t.pinned)) {
      const b = el('button');
      b.title = t.title;
      b.classList.toggle('active', t.active);
      b.append(favicon(t));
      b.onclick = () => activate(t);
      pinnedEl.append(b);
    }
  }
  pinnedEl.hidden = !pinnedEl.childElementCount;
}

function renderStats() {
  const keys = new Set(tabs.map(t => ticketKey(t)).filter(Boolean));
  const others = otherIds.size ? ` (+${otherIds.size} in other workspaces)` : '';
  statsEl.textContent = `${plural(tabs.length, 'tab')}${others} · ${plural(Object.keys(folders).length, 'folder')} · ${plural(keys.size, 'ticket')}`;
}

function render() {
  if (paused) {
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
  const q = qEl.value.trim().toLowerCase();
  if (!q && view !== 'tree') {
    renderSelBar();
    if (view === 'log') renderLog();
    else renderSettings();
    return;
  }
  const scroll = listEl.scrollTop;
  const out = document.createDocumentFragment();
  if (q) {
    renderSearch(q, out);
  } else {
    visible = [];
    if (!settings.onboarded && !guideLater) out.append(guideCard());
    for (const n of withOtherWorkspaces(root.children)) renderNode(n, 0, out);
  }
  renderSelBar();
  listEl.replaceChildren(out);
  listEl.scrollTop = scroll;
  if (q) listEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  const fresh = pendingRename && listEl.querySelector(`[data-folder="${pendingRename}"]`);
  if (fresh) {
    pendingRename = null;
    fresh.scrollIntoView({ block: 'nearest' });
    startRename(fresh, fresh.dataset.folder);
  }
}

// ---- diagnostics report ----

function apiNames(o) {
  if (!o) return 'none';
  const names = new Set();
  for (let p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const n of Object.getOwnPropertyNames(p)) names.add(n);
  }
  names.delete('constructor');
  return [...names].sort().join(', ') || '(empty)';
}

function fmtEvent(e) {
  const ts = new Date(e.t).toLocaleTimeString('en-GB', { hour12: false });
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

async function buildReport() {
  const ua = navigator.userAgent;
  const yes = v => (v ? 'yes' : 'no');
  const count = f => allTabs.filter(f).length;
  const keys = new Set(tabs.map(t => ticketKey(t)).filter(Boolean));
  const workspaces = new Map();
  for (const t of allTabs) workspaces.set(t.workspaceName ?? '(none)', (workspaces.get(t.workspaceName ?? '(none)') ?? 0) + 1);
  const currentWs = tabs[0]?.workspaceName ?? '(none)';
  const { log = [], changes = [], snapshot } = await chrome.storage.local.get(['log', 'changes', 'snapshot']);
  const { mirror = {} } = await chrome.storage.session.get('mirror').catch(() => ({}));
  const savedAt = snapshot ? new Date(snapshot.savedAt).toLocaleTimeString('en-GB', { hour12: false }) : null;
  const lines = [
    '## TabTrees probe',
    `- Opera ${ua.match(/OPR\/([\d.]+)/)?.[1] ?? '?'}, Chromium ${ua.match(/Chrome\/([\d.]+)/)?.[1] ?? '?'}, ${navigator.platform}`,
    `- opr: ${apiNames(globalThis.opr)}`,
    `- opr.sidebarAction: ${apiNames(globalThis.opr?.sidebarAction)}`,
    `- Tab fields: ${[...new Set(allTabs.flatMap(t => Object.keys(t)))].sort().join(', ')}`,
    `- chrome.sidebarAction: ${yes(chrome.sidebarAction)} · chrome.sidePanel: ${yes(chrome.sidePanel)} · chrome.tabGroups: ${yes(chrome.tabGroups)}`,
    `- Tabs in window: ${allTabs.length} (pinned ${count(t => t.pinned)}, active ${count(t => t.active)}, discarded ${count(t => t.discarded)}, in an island ${count(t => (t.groupId ?? -1) !== -1)}); lastAccessed: ${yes(allTabs.some(t => typeof t.lastAccessed === 'number'))}`,
    `- Workspaces: ${[...workspaces].map(([name, n]) => `«${name}» ${n}${name === currentWs ? ' (current)' : ''}`).join('; ')}`,
    `- Folders: ${Object.keys(folders).length}; mirrored as islands: ${settings.mirrorIslands === false ? 'off' : Object.keys(mirror).length}; ordered by hand: ${Object.keys(ranks).length}; kept out of automatic folders: ${Object.keys(declined).length}`,
    `- Tab placements: ${tabs.filter(t => parents[t.id] != null).length} of ${tabs.length} tabs; ticket keys: ${tabs.filter(t => ticketKey(t)).length} tabs, ${keys.size} distinct`,
    `- Snapshot for restarts: ${snapshot ? `${snapshot.tabs.length} tabs, ${snapshot.tabs.filter(s => s.parent != null).length} placements, saved ${savedAt}` : 'none yet'}`,
  ];
  const byTime = (a, b) => a.t - b.t;
  lines.push('', '### Events', '```', ...log.sort(byTime).slice(-60).map(fmtEvent), '```');
  lines.push('', '### Background tab changes', '```', ...changes.sort(byTime).slice(-30).map(fmtEvent), '```');
  return lines.join('\n');
}

async function renderLog() {
  const text = await buildReport();
  if (paused || view !== 'log' || qEl.value.trim()) return;
  listEl.replaceChildren(el('pre', 'log', text));
}

function flash(msg) {
  statsEl.textContent = msg;
  setTimeout(renderStats, 2500);
}

async function copyReport() {
  const text = await buildReport();
  try {
    await navigator.clipboard.writeText(text);
    flash('Report copied');
    return;
  } catch {}
  // Fallback: show the report in a textarea and freeze re-rendering until Esc.
  paused = true;
  const ta = el('textarea', 'report');
  ta.value = text;
  listEl.replaceChildren(ta);
  ta.select();
  flash(document.execCommand('copy') ? 'Report copied (Esc to go back)' : 'Copy it manually: Ctrl+C, then Esc');
}

$('#report').onclick = copyReport;

$('#new-folder').onclick = () => {
  if (!root) return;
  qEl.value = '';
  if (view !== 'tree') switchView('tree');
  addFolder(root);
};

// ---- wiring ----

function switchView(next) {
  view = next;
  if (next !== 'settings') prefs.set('view', next);
  for (const b of document.querySelectorAll('#views button[data-view]')) b.classList.toggle('on', b.dataset.view === next);
  closeMenu();
  paused = false;
  render();
}

for (const b of document.querySelectorAll('#views button[data-view]')) {
  b.classList.toggle('on', b.dataset.view === view);
  b.onclick = () => switchView(b.dataset.view);
}

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
  if (e.key === 'Escape') {
    paused = false;
    qEl.value = '';
    selection.clear();
    anchor = null;
    if (view !== 'tree') switchView('tree');
    else render();
  } else if (e.key === 'Delete' && selection.size && document.activeElement !== qEl) {
    $('#sel-close').click();
  } else if (e.key === '/' && document.activeElement !== qEl) {
    e.preventDefault();
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
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (['parents', 'folders', 'ranks', 'settings', 'declined'].some(k => k in changes)) refresh();
  else if (view === 'log') render();
});

refresh();
