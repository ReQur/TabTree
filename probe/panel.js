import { ticketKey, cleanTitle, rowLabel, kindLabel, hostOf, urlKey, islandName, colorFor } from './titles.js';
import { buildTree, tabIdsUnder, nodeRef, folderRef } from './tree.js';

const $ = sel => document.querySelector(sel);
const listEl = $('#list');
const pinnedEl = $('#pinned');
const statsEl = $('#stats');
const qEl = $('#q');
const mirrorEl = $('#mirror');
const autoFoldersEl = $('#auto-folders');
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

let view = prefs.get('view') === 'log' ? 'log' : 'tree';
const collapsed = new Set(prefs.get('collapsed', []));
let allTabs = []; // every tab of the window, all Opera workspaces
let tabs = []; // the workspace in use
let otherIds = new Set(); // tabs of the other workspaces
let parents = {}; // tab id -> parent tab id, "f:<folder id>", or -1 for the top level
let folders = {}; // folder id -> { name, color, parent, created }
let ranks = {}; // "t:<id>" / "f:<id>" -> order among siblings
let root = null; // the tree drawn last, for drops on the top level
let nodeByRef = new Map(); // "t:<id>" / "f:<id>" -> node of that tree
let visible = []; // refs of the drawn tree rows, top to bottom
let dupIds = new Set(); // extra copies of an already open URL
let hits = [];
let selected = 0;
let paused = false; // rendering is frozen while dragging, renaming, or showing the copy fallback
let pendingRename = null; // a folder just created, to rename as soon as it is drawn

async function load() {
  let list = await chrome.tabs.query({ currentWindow: true });
  if (!list.length) list = await chrome.tabs.query({ lastFocusedWindow: true });
  allTabs = list.sort((a, b) => a.index - b.index);
  const { current, others } = splitWorkspaces(allTabs);
  tabs = current;
  otherIds = new Set(others.map(t => t.id));
  dupIds = findDuplicates(tabs);
  const stored = await chrome.storage.local.get(['parents', 'folders', 'ranks', 'settings']);
  parents = stored.parents ?? {};
  folders = stored.folders ?? {};
  ranks = stored.ranks ?? {};
  mirrorEl.checked = !!chrome.tabGroups && stored.settings?.mirrorIslands !== false;
  mirrorEl.disabled = !chrome.tabGroups;
  autoFoldersEl.checked = stored.settings?.autoFolders !== false;
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

// A ticket family at the top level becomes a folder of its own, in the family's place.
function familyToFolder(node) {
  const id = newFolderId();
  const { key, title } = node.ticket;
  const order = node.parent.children.map(n => (n === node ? folderRef(id) : nodeRef(n)));
  send({ type: 'newFolder', id, name: islandName(key, title), color: colorFor(key), key, items: [nodeRef(node)], order });
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

function closeSelection() {
  const nodes = selectedNodes();
  send({ type: 'closeItems', tabIds: [...new Set(nodes.flatMap(tabIdsUnder))], folderIds: nodes.flatMap(foldersUnder) });
  selection.clear();
  anchor = null;
}

// The new folder takes the place of the first selected row, on the nearest level that can hold folders.
function selectionToFolder() {
  const nodes = selectedNodes();
  if (!nodes.length) return;
  let spot = nodes[0];
  while (spot.parent.tab) spot = spot.parent;
  const level = spot.parent;
  const id = newFolderId();
  const order = level.children.flatMap(n => [...(n === spot ? [folderRef(id)] : []), ...(nodes.includes(n) ? [] : [nodeRef(n)])]);
  pendingRename = id;
  selection.clear();
  anchor = null;
  send({ type: 'newFolder', id, parent: level.folder?.id ?? null, items: nodes.map(nodeRef), order });
}

function renderSelBar() {
  const nodes = selectedNodes();
  selBar.hidden = !nodes.length || view !== 'tree';
  if (selBar.hidden) return;
  const tabCount = new Set(nodes.flatMap(tabIdsUnder)).size;
  const folderCount = nodes.flatMap(foldersUnder).length;
  const what = [tabCount && plural(tabCount, 'tab'), folderCount && plural(folderCount, 'folder')].filter(Boolean).join(', ');
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
  render();
};

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
    button('badge on-hover', '✎', 'Rename folder', () => startRename(row, f.id)),
    button('badge on-hover', '✕', 'Delete folder; what is inside moves one level up', () => send({ type: 'deleteFolder', id: f.id })),
    el('span', 'count', String(ids.length)),
  );
  row.onclick = e => {
    if (!clickSelects(e, node)) toggle(id);
  };
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
  row.classList.toggle('selected', selection.has(nodeRef(node)));
  visible.push(nodeRef(node));
  row.onclick = e => {
    if (!clickSelects(e, node)) activate(t);
  };
  dragAndDrop(row, node);
  out.append(row);
  if (!isCollapsed) for (const c of node.children) renderNode(c, depth + 1, out);
}

function renderSearch(q, out) {
  const terms = q.split(/\s+/);
  hits = allTabs.filter(t => {
    const hay = `${t.title} ${t.url} ${ticketKey(t) ?? ''} ${kindLabel(t.url) ?? ''}`.toLowerCase();
    return terms.every(s => hay.includes(s));
  });
  selected = Math.max(0, Math.min(selected, hits.length - 1));
  hits.forEach((t, i) => {
    const key = ticketKey(t) ?? undefined;
    const row = tabRow(t, 0, { key, label: rowLabel(t, key, null) });
    if (otherIds.has(t.id)) row.append(el('span', 'badge', t.workspaceName || 'other workspace'));
    if (i === selected) row.classList.add('sel');
    out.append(row);
  });
  if (!hits.length) out.append(el('div', 'note', 'No matches'));
}

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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function renderStats() {
  const keys = new Set(tabs.map(t => ticketKey(t)).filter(Boolean));
  const others = otherIds.size ? ` (+${otherIds.size} in other workspaces)` : '';
  statsEl.textContent = `${plural(tabs.length, 'tab')}${others} · ${plural(Object.keys(folders).length, 'folder')} · ${plural(keys.size, 'ticket')}`;
}

function render() {
  if (paused) return;
  renderPinned();
  renderStats();
  const q = qEl.value.trim().toLowerCase();
  if (!q && view === 'log') {
    renderSelBar();
    renderLog();
    return;
  }
  const scroll = listEl.scrollTop;
  const out = document.createDocumentFragment();
  if (q) {
    renderSearch(q, out);
  } else {
    const tree = buildTree(tabs.filter(t => !t.pinned), parents, folders, ranks);
    root = tree.root;
    nodeByRef = new Map([...tree.nodes.values(), ...tree.folderNodes.values()].map(n => [nodeRef(n), n]));
    for (const ref of selection) if (!nodeByRef.has(ref)) selection.delete(ref);
    visible = [];
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
  const { log = [], changes = [], settings = {}, snapshot } = await chrome.storage.local.get(['log', 'changes', 'settings', 'snapshot']);
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
    `- Folders: ${Object.keys(folders).length}; mirrored as islands: ${settings.mirrorIslands === false ? 'off' : Object.keys(mirror).length}; ordered by hand: ${Object.keys(ranks).length}`,
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

$('#report').onclick = async () => {
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
};

$('#new-folder').onclick = () => {
  if (view !== 'tree' || !root) return;
  qEl.value = '';
  addFolder(root);
};

async function setSetting(name, value) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, [name]: value } });
}

mirrorEl.onchange = () => setSetting('mirrorIslands', mirrorEl.checked);
autoFoldersEl.onchange = () => setSetting('autoFolders', autoFoldersEl.checked);

// ---- wiring ----

for (const b of document.querySelectorAll('#views button[data-view]')) {
  b.classList.toggle('on', b.dataset.view === view);
  b.onclick = () => {
    view = b.dataset.view;
    prefs.set('view', view);
    for (const x of document.querySelectorAll('#views button[data-view]')) x.classList.toggle('on', x === b);
    paused = false;
    render();
  };
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
  if (e.key === 'Escape') {
    paused = false;
    qEl.value = '';
    selection.clear();
    anchor = null;
    render();
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
  if (['parents', 'folders', 'ranks', 'settings'].some(k => k in changes)) refresh();
  else if (view === 'log') render();
});

refresh();
