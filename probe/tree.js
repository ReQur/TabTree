// The tab tree shared by the panel (to draw it) and the background (to mirror folders as islands).
import { ticketKey, isIssuePage, groupTitle } from './titles.js';

export const tabRef = id => `t:${id}`;
export const folderRef = id => `f:${id}`;
export const nodeRef = node => (node.tab ? tabRef(node.tab.id) : node.folder ? folderRef(node.folder.id) : 'root');

// The tab a ticket hangs from: its Jira issue page if one is open, else its first tab in the tab strip.
export function pickRoot(tabs, key) {
  const sorted = [...tabs].sort((a, b) => a.index - b.index);
  return sorted.find(t => isIssuePage(t, key)) ?? sorted[0];
}

// Builds the tree of the given tabs (one window and workspace).
// - Folders nest; `folders[id].parent` is the enclosing folder's id, or null at the top level.
// - `parents[tabId]` places a tab: under another tab (that tab's id), straight into a folder ("f:<id>"), or
//   at the top level (-1). Openers are written there when tabs open; drag and drop overwrites them.
// - A ticket hangs from its Jira issue tab (or its first tab), and its other tabs always hang under that
//   root, wherever the root is. A ticket goes where its root was placed, else where another of its tabs
//   was; a ticket opened from another ticket's tab hangs under that ticket's root.
// - Siblings follow `ranks` (set by drag and drop). Unranked ones come after them: folders first, then a
//   ticket's own pages, then tab-strip order.
export function buildTree(tabs, parents = {}, folders = {}, ranks = {}) {
  const root = { root: true, children: [], parent: null };
  const nodes = new Map(tabs.map(t => [t.id, { tab: t, children: [], parent: null }]));
  const folderNodes = new Map(
    Object.entries(folders).map(([id, f]) => [id, { folder: { id, ...f }, children: [], parent: null }]),
  );
  const keyOf = new Map(tabs.map(t => [t.id, ticketKey(t)]));
  const byKey = new Map();
  for (const t of tabs) {
    const key = keyOf.get(t.id);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), t]);
  }
  const rootOf = new Map([...byKey].map(([key, list]) => [key, pickRoot(list, key)]));

  // An explicit place: a tab id, "f:<id>", null for the top level; undefined when there is none.
  const placed = t => {
    const p = parents[t.id];
    if (typeof p === 'string') return folderNodes.has(p.slice(2)) ? p : undefined;
    if (p === -1) return null;
    return p !== t.id && nodes.has(p) ? p : undefined;
  };

  const up = new Map(); // tab id -> a tab id, "f:<folder id>", or null for the top level
  for (const t of tabs) {
    const key = keyOf.get(t.id);
    if (key && rootOf.get(key) !== t) up.set(t.id, rootOf.get(key).id);
    else if (!key) up.set(t.id, placed(t) ?? null);
  }
  const isBelow = (id, ancestor) => {
    for (let cur = up.get(id), steps = 0; typeof cur === 'number' && steps <= tabs.length; cur = up.get(cur), steps++) {
      if (cur === ancestor) return true;
    }
    return false;
  };
  for (const [key, rootTab] of rootOf) {
    const others = byKey.get(key).filter(t => t !== rootTab).sort((a, b) => a.index - b.index);
    let where = null;
    for (const c of [rootTab, ...others]) {
      let p = placed(c);
      if (p === undefined) continue;
      if (typeof p === 'number') {
        if (keyOf.get(p) === key) continue; // a link inside the ticket itself
        if (keyOf.get(p)) p = rootOf.get(keyOf.get(p)).id; // another ticket's tab stands for its root
        if (p === rootTab.id || isBelow(p, rootTab.id)) continue;
      }
      where = p;
      break;
    }
    up.set(rootTab.id, where);
  }
  const inCycle = id => {
    const seen = new Set();
    for (let cur = id; typeof cur === 'number'; cur = up.get(cur)) {
      if (seen.has(cur)) return true;
      seen.add(cur);
    }
    return false;
  };
  for (const t of tabs) if (inCycle(t.id)) up.set(t.id, null);

  const folderUp = new Map();
  for (const [id, node] of folderNodes) {
    const p = node.folder.parent;
    folderUp.set(id, p != null && p !== id && folderNodes.has(p) ? p : null);
  }
  for (const id of folderUp.keys()) {
    const seen = new Set();
    for (let cur = id; cur != null; cur = folderUp.get(cur)) {
      if (seen.has(cur)) {
        folderUp.set(id, null);
        break;
      }
      seen.add(cur);
    }
  }

  const attach = (node, parent) => {
    node.parent = parent;
    parent.children.push(node);
  };
  for (const [id, node] of folderNodes) attach(node, folderNodes.get(folderUp.get(id)) ?? root);
  for (const t of tabs) {
    const p = up.get(t.id);
    const parent = typeof p === 'number' ? nodes.get(p) : typeof p === 'string' ? folderNodes.get(p.slice(2)) : root;
    attach(nodes.get(t.id), parent);
  }

  for (const [key, rootTab] of rootOf) {
    const node = nodes.get(rootTab.id);
    node.ticket = { key, title: groupTitle(byKey.get(key), key) };
    for (const c of node.children) {
      if (c.tab && keyOf.get(c.tab.id) === key) Object.assign(c, { groupKey: key, groupTitle: node.ticket.title });
    }
  }

  const rankOf = n => ranks[nodeRef(n)] ?? Infinity;
  const byOrder = owner => (a, b) =>
    rankOf(a) - rankOf(b) ||
    !!b.folder - !!a.folder ||
    (a.folder?.created ?? 0) - (b.folder?.created ?? 0) ||
    (owner.ticket ? (b.groupKey === owner.ticket.key) - (a.groupKey === owner.ticket.key) : 0) ||
    (a.tab?.index ?? 0) - (b.tab?.index ?? 0);
  for (const node of [root, ...folderNodes.values(), ...nodes.values()]) node.children.sort(byOrder(node));
  return { root, nodes, folderNodes };
}

export const tabIdsUnder = node => [...(node.tab ? [node.tab.id] : []), ...node.children.flatMap(tabIdsUnder)];
