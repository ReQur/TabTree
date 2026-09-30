// Logs tab events, remembers which tab opened which, keeps the tree and its folders across restarts, puts
// ticket families into folders, and mirrors top-level folders as Opera islands.
import { hostOf, ticketKey, colorFor, islandName } from './titles.js';
import { buildTree, tabIdsUnder, pickRoot, nodeRef, folderRef } from './tree.js';
import { snapshotOf, matchTabs, restoredParents, restoredRanks } from './snapshot.js';
import { probeSite, detectSites, pollSites, originPattern, forgetChanges, STATUS_FORMAT } from './integrations.js';

const LIMITS = { log: 200, changes: 100 };
// Browser pages (settings, extensions, the start page) get the active tab as opener; that link means nothing.
const INTERNAL = /^(opera|chrome|edge|about):/;
// What the tree is made of: tab placements, folders, and the order among siblings.
const TREE_KEYS = ['parents', 'folders', 'ranks'];
let queue = Promise.resolve();

// Serialized read-modify-write: events come in bursts and would otherwise overwrite each other.
function update(key, fn) {
  const step = queue.then(async () => {
    const { [key]: value } = await chrome.storage.local.get(key);
    await chrome.storage.local.set({ [key]: fn(value) });
    if (TREE_KEYS.includes(key)) {
      scheduleSave();
      scheduleMirror();
    }
  });
  queue = step.catch(e => console.error(`probe: update ${key} failed`, e));
  return step;
}

function record(bucket, entry) {
  entry.t ??= Date.now();
  update(bucket, (list = []) => [...list, entry].slice(-LIMITS[bucket]));
}

// Parent links are captured when a tab is created: Chromium's openerTabId does not last
// (it is dropped when the opener closes), so the tree has to be remembered here.
function setParent(child, parent, { overwrite = true } = {}) {
  update('parents', (p = {}) => (overwrite || !(child in p) ? { ...p, [child]: parent } : p));
}

async function hostOfTab(tabId) {
  if (tabId == null) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    return hostOf(tab.url || tab.pendingUrl);
  } catch {
    return '(closed)';
  }
}

// ---- keeping the tree across restarts ----
// Tab ids die with the browser session, so a snapshot of the tree (URLs, positions, folders, order) is
// saved after every change. storage.session is emptied when the browser restarts (and when the extension
// reloads): the first worker of a new session rebuilds the tab placements from the last snapshot.
// Folders themselves have stable ids and need no rebuilding.

const SETTLE_MS = 2000; // session restore is over when the tab count has held still this long
let saveTimer = 0;

const ready = (async () => {
  const { sid } = await chrome.storage.session.get('sid');
  if (sid) return; // same browser session; the worker just woke up
  await chrome.storage.session.set({ sid: Date.now() });
  await restore();
  await migrateIslands();
  scheduleSave(); // so that a restart right away still finds a snapshot
  scheduleMirror();
})().catch(e => console.error('probe: start failed', e));

async function settled() {
  const start = Date.now();
  let count = -1;
  let since = start;
  while (Date.now() - since < SETTLE_MS && Date.now() - start < 30_000) {
    const n = (await chrome.tabs.query({})).length;
    if (n !== count) {
      count = n;
      since = Date.now();
    }
    await new Promise(r => setTimeout(r, 250));
  }
}

async function restore() {
  const { snapshot } = await chrome.storage.local.get('snapshot');
  if (!snapshot?.tabs?.length) return;
  await settled();
  const current = await chrome.tabs.query({});
  const match = matchTabs(snapshot.tabs, current);
  const matched = new Set(match.values());
  const alive = new Set(current.map(t => t.id));
  const restored = restoredParents(snapshot.tabs, match);
  // Links of tabs opened while the session was being restored stay; ids of the old session go.
  const fresh = ([c, v]) => alive.has(Number(c)) && !matched.has(Number(c)) && (typeof v === 'string' || v === -1 || alive.has(v));
  await update('parents', (p = {}) => ({ ...Object.fromEntries(Object.entries(p).filter(fresh)), ...restored }));
  await update('ranks', (r = {}) => ({
    ...Object.fromEntries(Object.entries(r).filter(([k]) => k.startsWith('f:'))),
    ...restoredRanks(snapshot.tabs, match),
  }));
  record('log', { ev: 'restored', matched: match.size, saved: snapshot.tabs.length, links: Object.keys(restored).length });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Not before the restore has read the previous session's snapshot.
    ready.then(() => {
      queue = queue
        .then(async () => {
          const [tabs, { parents = {}, ranks = {} }] = await Promise.all([
            chrome.tabs.query({}),
            chrome.storage.local.get(['parents', 'ranks']),
          ]);
          await chrome.storage.local.set({ snapshot: { savedAt: Date.now(), tabs: snapshotOf(tabs, parents, ranks) } });
        })
        .catch(e => console.error('probe: save failed', e));
    });
  }, 1000);
}

// ---- folders ----

const newFolderId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const mirrorKey = (folderId, tab) => `${folderId}|${tab.windowId}|${tab.workspaceId ?? ''}`;

// The first run with folders turns the existing islands into top-level folders of the same name and color.
// Each folder adopts its island as its mirror, so no tab moves.
async function migrateIslands() {
  const { folders, parents = {} } = await chrome.storage.local.get(['folders', 'parents']);
  if (folders) return;
  const groups = chrome.tabGroups ? await chrome.tabGroups.query({}) : [];
  const tabs = (await chrome.tabs.query({})).filter(t => !t.pinned);
  const made = {};
  const placed = {};
  const mirror = {};
  groups.forEach((g, i) => {
    const id = newFolderId();
    const members = tabs.filter(t => t.groupId === g.id);
    made[id] = { name: g.title || 'Untitled', color: g.color, parent: null, created: Date.now() + i };
    // The top of the island's tree goes into the folder; everything below follows it.
    for (const node of buildTree(members, parents).root.children) placed[node.tab.id] = `f:${id}`;
    if (members.length) mirror[mirrorKey(id, members[0])] = g.id;
  });
  await update('folders', () => made);
  await update('parents', (p = {}) => ({ ...p, ...placed }));
  await chrome.storage.session.set({ mirror });
  await chrome.storage.local.remove(['manual']);
  record('log', { ev: 'migrated', folders: groups.length });
}

const setOrder = order => update('ranks', (r = {}) => ({ ...r, ...Object.fromEntries(order.map((k, i) => [k, i + 1])) }));
const tabIdsOf = refs => refs.filter(r => r.startsWith('t:')).map(r => r.slice(2));
const folderIdsOf = refs => refs.filter(r => r.startsWith('f:')).map(r => r.slice(2));

// Moves tabs and folders (refs "t:<id>", "f:<id>") under `parent`: "root", "f:<id>", or "t:<id>" (tabs only).
async function putUnder(refs, parent) {
  const tabIds = tabIdsOf(refs);
  const folderIds = folderIdsOf(refs);
  if (folderIds.length && parent.startsWith('t:')) throw new Error('a folder cannot go under a tab');
  if (tabIds.length) {
    const where = parent === 'root' ? -1 : parent.startsWith('f:') ? parent : Number(parent.slice(2));
    await update('parents', (p = {}) => ({ ...p, ...Object.fromEntries(tabIds.map(id => [id, where])) }));
  }
  if (folderIds.length) {
    const into = parent === 'root' ? null : parent.slice(2);
    await update('folders', (f = {}) => {
      const next = { ...f };
      for (const id of folderIds) if (next[id] && id !== into) next[id] = { ...next[id], parent: into };
      return next;
    });
  }
}

// A folder made for a ticket family remembers the ticket (`key`); `auto` marks the ones made automatically.
// `items` go inside it in that order; `order` lists the enclosing level's children with the new folder in place.
async function newFolder({ id, parent = null, name = 'New folder', color, key, auto = false, items = [], order = [] }) {
  if (!/^[a-z0-9]+$/.test(id ?? '')) throw new Error('bad folder id');
  const folder = { name, color: color ?? colorFor(id), parent, created: Date.now(), ...(key && { key }), ...(auto && { auto }) };
  await update('folders', (f = {}) => ({ ...f, [id]: folder }));
  if (items.length) {
    await putUnder(items, `f:${id}`);
    await setOrder(items);
  }
  if (order.length) await setOrder(order);
  record('log', { ev: 'folder', action: auto ? 'auto' : 'create', name });
}

// Renaming makes an automatic folder the user's own: it stays even when it empties.
async function renameFolder({ id, name }) {
  await update('folders', (f = {}) => {
    if (!f[id]) return f;
    const { auto, ...kept } = f[id];
    return { ...f, [id]: { ...kept, name: name || 'Untitled' } };
  });
}

async function colorFolder({ id, color }) {
  await update('folders', (f = {}) => (f[id] ? { ...f, [id]: { ...f[id], color } } : f));
}

const decline = keys => keys.length && update('declined', (d = {}) => ({ ...d, ...Object.fromEntries(keys.map(k => [k, true])) }));

// Deleted folders' tabs and folders move up into the nearest folder that stays. A family folder deleted by
// the user is not made again automatically (`declined`).
async function deleteFolders({ ids, declineFamilies = true }) {
  const { folders = {} } = await chrome.storage.local.get('folders');
  const gone = new Set(ids.filter(id => folders[id]));
  if (!gone.size) return;
  const outer = id => {
    let p = folders[id]?.parent ?? null;
    while (p != null && gone.has(p)) p = folders[p]?.parent ?? null;
    return p;
  };
  const outerRef = id => (outer(id) != null ? `f:${outer(id)}` : -1);
  await update('parents', (p = {}) =>
    Object.fromEntries(Object.entries(p).map(([c, v]) => [c, typeof v === 'string' && gone.has(v.slice(2)) ? outerRef(v.slice(2)) : v])),
  );
  await update('folders', (f = {}) => {
    const next = {};
    for (const [id, folder] of Object.entries(f)) {
      if (gone.has(id)) continue;
      next[id] = gone.has(folder.parent) ? { ...folder, parent: outer(folder.parent) } : folder;
    }
    return next;
  });
  await update('ranks', (r = {}) => Object.fromEntries(Object.entries(r).filter(([k]) => !(k.startsWith('f:') && gone.has(k.slice(2))))));
  if (declineFamilies) await decline([...gone].map(id => folders[id].key).filter(Boolean));
  for (const id of gone) record('log', { ev: 'folder', action: 'delete', name: folders[id].name });
}

const deleteFolder = ({ id }) => deleteFolders({ ids: [id] });

// Drag and drop: `nodes` go under `parent`, and `order` lists the parent's children in their new order.
// A family taken out of its folder to the top level is not put into an automatic folder again.
async function place({ nodes, parent, order = [] }) {
  const { parents = {}, folders = {} } = await chrome.storage.local.get(['parents', 'folders']);
  await putUnder(nodes, parent);
  if (order.length) await setOrder(order);
  if (parent === 'root') {
    const left = tabIdsOf(nodes).map(id => parents[id]).filter(v => typeof v === 'string');
    await decline(left.map(v => folders[v.slice(2)]?.key).filter(Boolean));
  }
  record('log', { ev: 'place', node: nodes.join(','), parent });
}

// Closing a selection: its tabs close, and its folders go with them.
async function closeItems({ tabIds = [], folderIds = [] }) {
  if (tabIds.length) await chrome.tabs.remove(tabIds);
  if (folderIds.length) await deleteFolders({ ids: folderIds, declineFamilies: false });
  record('log', { ev: 'closed', tabs: tabIds.length, folders: folderIds.length });
}

// Settings → "Never for": the ticket may get an automatic folder again, right away if its family qualifies.
async function allowAutoFolder({ key }) {
  await update('declined', (d = {}) => {
    const { [key]: _, ...rest } = d;
    return rest;
  });
  scheduleMirror();
}

// A tab the panel opens (a card's "Open pipeline", "Sign in"): the panel says where it belongs, since Opera gives a tab
// made by an extension the tab in view as its opener, whatever it was asked for. `parent` is a tab id, or -1 for the
// top level; the URL is remembered until the new tab is reported, whichever comes first.
const placing = new Map();

async function openTab({ url, parent }) {
  if (!/^https?:\/\//.test(url)) throw new Error('not a page to open');
  placing.set(url, parent);
  setTimeout(() => placing.delete(url), 10_000);
  const tab = await chrome.tabs.create({ url, active: true, ...(parent > 0 ? { openerTabId: parent } : {}) });
  setParent(tab.id, parent);
}

// Settings › Statuses: the probe asks a site's API from here, where statuses would be fetched from, and keeps
// the answers for the report.
async function probeApi({ site }) {
  if (!['jira', 'gitlab', 'jenkins'].includes(site?.kind) || !/^https?:\/\//.test(site.base)) throw new Error('not a site to probe');
  const results = await probeSite(site);
  const entry = { kind: site.kind, origin: site.origin, t: Date.now(), results };
  await update('apiProbe', (all = {}) => ({ ...all, [site.base]: entry }));
  return entry;
}

// A site's rest (after it signed out or couldn't be reached) ends: it is asked again at the next round.
async function unrest(base) {
  if (watching) await watching;
  const { watch: memo = {} } = await chrome.storage.session.get('watch');
  if (!memo.due?.[`site ${base}`]) return false;
  delete memo.due[`site ${base}`];
  await chrome.storage.session.set({ watch: memo });
  return true;
}

// Retry, from the panel: the site is asked again right now.
async function retrySite({ base }) {
  await unrest(base);
  await watchNow();
  return {};
}

const commands = { place, newFolder, renameFolder, colorFolder, deleteFolder, closeItems, allowAutoFolder, openTab };
// Questions that change no tree run beside the commands' queue, so that a slow site can't hold up a drop. Their
// answer comes with the reply.
const queries = { probeApi, retrySite };
let running = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const query = queries[msg?.type];
  if (query) {
    query(msg).then(
      answer => reply({ ok: true, ...answer }),
      e => reply({ ok: false, error: e.message }),
    );
    return true;
  }
  const command = commands[msg?.type];
  if (!command) return false;
  const job = running.then(() => ready).then(() => command(msg));
  running = job.catch(() => {});
  job.then(
    () => reply({ ok: true }),
    e => reply({ ok: false, error: e.message }),
  );
  return true; // the reply comes asynchronously
});

// ---- tidying up after every change: automatic folders, then the island mirror ----

const ours = new Set(); // tabs this worker is moving right now
const keyOfTab = new Map(); // tab id -> ticket key as last seen, to notice a tab that became another ticket
let mirrorTimer = 0;
let mirroring = Promise.resolve();

function scheduleMirror() {
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => {
    ready.then(() => {
      mirroring = mirroring.then(tidy).catch(e => console.error('probe: tidy failed', e));
    });
  }, 400);
}

async function tidy() {
  const stored = await chrome.storage.local.get(['settings', 'declined', ...TREE_KEYS]);
  const all = (await chrome.tabs.query({})).filter(t => !t.pinned && !t.incognito);
  // Islands never span windows or workspaces, so each of those gets its own tree.
  const scopes = new Map();
  for (const t of all) {
    const scope = `${t.windowId}|${t.workspaceId ?? ''}`;
    scopes.set(scope, [...(scopes.get(scope) ?? []), t]);
  }
  const trees = [...scopes.values()].map(tabs => ({ tabs, ...buildTree(tabs, stored.parents, stored.folders, stored.ranks) }));
  if (await autoFolders(stored, trees)) return; // the storage change brings another pass
  if (chrome.tabGroups) await mirrorNow(stored, all, trees);
}

// Families that may get an automatic folder: tickets on the top level, and tickets hanging from a page
// without a key on the top level (a hub such as an MR list), which then leave that page.
function familiesOnTop(root) {
  const found = [];
  for (const node of root.children) {
    if (node.ticket) found.push({ node, after: node });
    else if (node.tab) for (const c of node.children) if (c.ticket) found.push({ node: c, after: node });
  }
  return found;
}

// A ticket family on the top level gets a folder of its own at its second tab, unless the user took that
// family out of such a folder before. Automatic folders that end up empty go away.
async function autoFolders(stored, trees) {
  let changed = false;
  if (stored.settings?.autoFolders !== false) {
    for (const { root } of trees) {
      for (const { node, after } of familiesOnTop(root)) {
        const { key, title } = node.ticket;
        if (stored.declined?.[key] || tabIdsUnder(node).length < 2) continue;
        const id = newFolderId();
        // In the family's place, or right after the hub it hung from.
        const order = root.children.flatMap(n => {
          if (n === after && n === node) return [folderRef(id)];
          return n === after ? [nodeRef(n), folderRef(id)] : [nodeRef(n)];
        });
        await newFolder({ id, name: islandName(key, title), color: colorFor(key), key, auto: true, items: [nodeRef(node)], order });
        changed = true;
      }
    }
  }
  const empty = Object.entries(stored.folders ?? {})
    .filter(([id, f]) => f.auto && trees.every(({ folderNodes }) => !folderNodes.get(id)?.children.length))
    .map(([id]) => id);
  if (empty.length) {
    await deleteFolders({ ids: empty, declineFamilies: false });
    changed = true;
  }
  return changed;
}

// ---- mirroring top-level folders as islands ----
// One way only: each top-level folder with two or more tabs is shown as an island with the folder's name
// and color (Opera keeps no one-tab islands), and every other tab is kept out of islands. Changes made to
// islands in Opera itself are undone on the next pass.

// groupId: an island to join, undefined for a new island, -1 to leave islands.
async function move(tabIds, groupId) {
  for (const id of tabIds) ours.add(id);
  setTimeout(() => tabIds.forEach(id => ours.delete(id)), 3000);
  if (groupId === -1) return chrome.tabs.ungroup(tabIds);
  return chrome.tabs.group(groupId != null ? { groupId, tabIds } : { tabIds });
}

async function mirrorNow(stored, all, trees) {
  const { mirror = {} } = await chrome.storage.session.get('mirror');
  if (stored.settings?.mirrorIslands === false) {
    // Switched off: let go of the islands this extension made.
    const made = new Set(Object.values(mirror));
    const ids = all.filter(t => made.has(t.groupId)).map(t => t.id);
    if (ids.length) await move(ids, -1);
    if (Object.keys(mirror).length) await chrome.storage.session.set({ mirror: {} });
    return;
  }
  const units = [];
  for (const { tabs, root } of trees) {
    for (const node of root.children) {
      const ids = node.folder ? tabIdsUnder(node) : [];
      if (ids.length >= 2) units.push({ folder: node.folder, ids, key: mirrorKey(node.folder.id, tabs[0]) });
    }
  }

  const alive = new Map((await chrome.tabGroups.query({})).map(g => [g.id, g]));
  const groupOf = new Map(all.map(t => [t.id, t.groupId]));
  const want = new Map(all.map(t => [t.id, -1]));
  const next = {};
  let moved = 0;
  for (const u of units) {
    let gid = alive.has(mirror[u.key]) ? mirror[u.key] : undefined;
    if (gid === undefined) {
      // Adopt the island that holds most of the folder's tabs, unless another folder took it already.
      const taken = new Set(Object.values(next));
      const votes = new Map();
      for (const id of u.ids) {
        const g = groupOf.get(id);
        if (g !== -1 && !taken.has(g)) votes.set(g, (votes.get(g) ?? 0) + 1);
      }
      [gid] = [...votes].sort((a, b) => b[1] - a[1])[0] ?? [];
    }
    const missing = u.ids.filter(id => groupOf.get(id) !== gid);
    if (gid === undefined) gid = await move(u.ids);
    else if (missing.length) await move(missing, gid);
    moved += missing.length;
    const g = alive.get(gid);
    if (g?.title !== u.folder.name || g?.color !== u.folder.color) {
      await chrome.tabGroups.update(gid, { title: u.folder.name, color: u.folder.color });
    }
    next[u.key] = gid;
    for (const id of u.ids) want.set(id, gid);
  }
  const stray = all.filter(t => want.get(t.id) === -1 && t.groupId !== -1).map(t => t.id);
  if (stray.length) await move(stray, -1);
  await chrome.storage.session.set({ mirror: next });
  if (moved || stray.length) record('log', { ev: 'mirror', islands: units.length, moved, ungrouped: stray.length });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'settings' in changes) {
    scheduleMirror();
    watchSoon();
  }
});

// ---- statuses: the watch over tickets, merge requests, pipelines, jobs and builds of the open tabs ----
// Only sites connected in Settings › Statuses are asked, with the browser's session. An alarm wakes the worker
// every 30 s; pollSites() asks only for what is due (30 s while something runs, longer otherwise). The statuses
// go under `status` (written only when they change) for the panel; the timings stay in storage.session.

const WATCH = 'statuses';
let watching = null;
let soon = 0;

function watchNow() {
  watching ??= (async () => {
    try {
      const { settings = {}, status: kept = {} } = await chrome.storage.local.get(['settings', 'status']);
      const older = kept.format !== STATUS_FORMAT;
      const previous = older ? forgetChanges(kept) : kept;
      const granted = new Set((await chrome.permissions?.getAll?.())?.origins ?? []);
      const tabs = settings.statuses === false ? [] : await chrome.tabs.query({});
      const sites = detectSites(tabs, Infinity).filter(site => granted.has(originPattern(site)));
      const { watch: memo = {} } = await chrome.storage.session.get('watch');
      const round = await pollSites({ sites, previous, memo });
      await chrome.storage.session.set({ watch: round.memo });
      if (round.changed || older) await chrome.storage.local.set({ status: { ...round.status, format: STATUS_FORMAT } });
    } catch (e) {
      console.error('probe: the statuses watch failed', e);
    } finally {
      watching = null;
    }
  })();
  return watching;
}

// A page of a site that signed out has loaded: maybe that was the sign-in, so the site is asked again.
async function afterSignIn(url = '') {
  const { status = {} } = await chrome.storage.local.get('status');
  const base = Object.keys(status.sites ?? {}).find(b => status.sites[b].error === 'signed out' && url.startsWith(`${b}/`));
  if (base && (await unrest(base))) watchSoon();
}

// A new page, or switching the watch on: asked about in a moment instead of at the next alarm.
function watchSoon() {
  clearTimeout(soon);
  soon = setTimeout(watchNow, 3000);
}

// The alarm runs only while some site is connected, so that the worker isn't woken for nothing.
async function keepWatching() {
  if (!chrome.alarms) return;
  const connected = ((await chrome.permissions?.getAll?.())?.origins ?? []).length > 0;
  const alarm = await chrome.alarms.get(WATCH);
  if (connected && !alarm) chrome.alarms.create(WATCH, { periodInMinutes: 0.5 });
  if (!connected && alarm) chrome.alarms.clear(WATCH);
}

chrome.alarms?.onAlarm.addListener(alarm => {
  if (alarm.name === WATCH) watchNow();
});
for (const event of [chrome.permissions?.onAdded, chrome.permissions?.onRemoved]) {
  event?.addListener(() => {
    keepWatching();
    watchSoon();
  });
}
keepWatching();

// ---- tab events ----

chrome.tabs.onCreated.addListener(async tab => {
  const t = Date.now();
  const internal = INTERNAL.test(tab.pendingUrl || tab.url || '');
  const planned = placing.get(tab.pendingUrl || tab.url);
  if (planned != null) {
    placing.delete(tab.pendingUrl || tab.url);
    setParent(tab.id, planned);
  } else if (tab.openerTabId != null && !internal) {
    setParent(tab.id, tab.openerTabId);
  }
  keyOfTab.set(tab.id, ticketKey(tab));
  scheduleSave();
  scheduleMirror();
  record('log', {
    t,
    ev: 'created',
    id: tab.id,
    index: tab.index,
    opener: tab.openerTabId ?? null,
    openerHost: await hostOfTab(tab.openerTabId),
    groupId: tab.groupId ?? null,
    active: tab.active,
    host: hostOf(tab.pendingUrl || tab.url),
  });
});

chrome.webNavigation.onCreatedNavigationTarget.addListener(async d => {
  const t = Date.now();
  // Fallback for links that open without an opener (rel=noopener).
  if (!INTERNAL.test(d.url)) setParent(d.tabId, d.sourceTabId, { overwrite: false });
  record('log', {
    t,
    ev: 'navTarget',
    id: d.tabId,
    source: d.sourceTabId,
    sourceHost: await hostOfTab(d.sourceTabId),
    host: hostOf(d.url),
  });
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url !== undefined) {
    scheduleSave();
    watchSoon();
  }
  if (change.status === 'complete') afterSignIn(tab.url);
  // A tab that became another ticket moves in the tree, and maybe to another island.
  if (change.title !== undefined || change.url !== undefined) {
    const key = ticketKey(tab);
    if (key !== (keyOfTab.get(tabId) ?? null)) {
      keyOfTab.set(tabId, key);
      scheduleMirror();
    }
  }
  // Islands mirror the folders: a change made to them in Opera itself gets undone.
  if ('groupId' in change && !ours.has(tabId)) scheduleMirror();
  // Title/favicon changes in tabs you are not looking at: raw material for a "changed since you looked" marker.
  if (tab.active || tab.status !== 'complete') return;
  if (change.favIconUrl !== undefined) record('changes', { ev: 'favicon', id: tabId, host: hostOf(tab.url) });
  else if (change.title !== undefined) record('changes', { ev: 'title', id: tabId, host: hostOf(tab.url) });
});

// Closing a tab moves its children up one level; a ticket's next root takes over the ticket's place.
chrome.tabs.onRemoved.addListener(async (tabId, info) => {
  const key = keyOfTab.get(tabId);
  keyOfTab.delete(tabId);
  // A closing window (or the whole browser shutting down) must leave the tree and its snapshot alone.
  if (info?.isWindowClosing) return;
  let heir;
  if (key) {
    const mates = (await chrome.tabs.query({})).filter(t => t.id !== tabId && ticketKey(t) === key);
    if (mates.length) heir = pickRoot(mates, key).id;
  }
  update('parents', (p = {}) => {
    const next = {};
    for (const [child, parent] of Object.entries(p)) {
      if (Number(child) === tabId) continue;
      const np = parent === tabId ? p[tabId] : parent;
      if (np != null) next[child] = np;
    }
    if (heir !== undefined && p[tabId] !== undefined && next[heir] === undefined) next[heir] = p[tabId];
    return next;
  });
  update('ranks', (r = {}) => {
    const { [`t:${tabId}`]: _, ...rest } = r;
    return rest;
  });
});

for (const event of [chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached]) event.addListener(scheduleSave);

// Prerendered pages swap in under a new tab id.
chrome.tabs.onReplaced.addListener((added, removed) => {
  keyOfTab.set(added, keyOfTab.get(removed) ?? null);
  keyOfTab.delete(removed);
  update('parents', (p = {}) => {
    const next = {};
    for (const [child, parent] of Object.entries(p)) {
      next[Number(child) === removed ? added : child] = parent === removed ? added : parent;
    }
    return next;
  });
  update('ranks', (r = {}) => {
    const { [`t:${removed}`]: rank, ...rest } = r;
    return rank == null ? r : { ...rest, [`t:${added}`]: rank };
  });
});

async function logTabCounts(ev) {
  const tabs = await chrome.tabs.query({});
  record('log', {
    ev,
    tabs: tabs.length,
    withOpener: tabs.filter(t => t.openerTabId != null).length,
    withGroup: tabs.filter(t => (t.groupId ?? -1) !== -1).length,
    discarded: tabs.filter(t => t.discarded).length,
  });
}

// The tree itself comes back through `ready` (see "keeping the tree across restarts").
chrome.runtime.onInstalled.addListener(() => logTabCounts('installed'));

chrome.runtime.onStartup.addListener(() => {
  logTabCounts('startup');
  // Session restore may still be running when onStartup fires, so look again.
  setTimeout(() => logTabCounts('startup+10s'), 10_000);
});
