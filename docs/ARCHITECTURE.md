# TabTree: how it works

What the extension does from the user's side is in [FEATURES.md](FEATURES.md). This file is for changing it.

## Pieces

```
Opera: tabs, islands (tab groups), workspaces
        │  tab events                          ▲ tabs.group / ungroup, tabGroups.update
        ▼                                      │
  probe/background.js  (MV3 service worker) ───┘
        │  owns every write to the tree        ▲ commands: place, newFolder, …  (runtime.sendMessage)
        ▼                                      │
  chrome.storage.local  ──── onChanged ───▶  probe/panel.js  (the sidebar page: a view)
```

- `manifest.json`: MV3. Declares `sidebar_action` (Opera's own sidebar API; Opera has no `chrome.sidePanel`), a
  module service worker, and the permissions `tabs`, `webNavigation`, `storage`, `tabGroups`, `clipboardWrite`.
- `background.js`: the only writer of the tree.
  - Records openers when tabs open.
  - Handles the panel's commands.
  - Saves a snapshot and restores it after restarts.
  - Runs `tidy()`: automatic folders, then the island mirror.
  - Keeps the event log.
- `tree.js`: pure. `buildTree()` turns tabs + stored placements into the tree, including the ticket rules, the
  order and the cycle guards.
- `titles.js`: pure. Ticket keys, title cleanup, page kinds, row labels, folder names and colors for tickets.
- `snapshot.js`: pure. Snapshot format and matching restored tabs back to it.
- `panel.html` / `panel.css` / `panel.js`: the UI.
  - Reads tabs and storage, draws the tree, handles search, selection and drag and drop.
  - Turns every change into a command for the background. It never writes the tree itself.
  - Also builds the diagnostics report.
- `icons/`: generated PNGs (16, 32, 48, 128).

No build step and no runtime dependencies. `package.json` exists only for the tests (jsdom).

## Stored data

`chrome.storage.local`:

| key | shape | meaning |
|---|---|---|
| `parents` | `{ [tabId]: number \| "f:<folderId>" \| -1 }` | where a tab is placed: under a tab, straight in a folder, or on the top level by hand. Written when a tab opens (its opener) and by drag and drop. Ignored for a ticket's non-root pages, which always hang under the ticket's root. |
| `folders` | `{ [id]: { name, color, parent: id \| null, created, key?, auto? } }` | folder ids are stable across restarts (base36 time + random). `key` = the ticket a family folder was made for; `auto` = made automatically (dropped on rename). |
| `ranks` | `{ ["t:<tabId>" \| "f:<folderId>"]: number }` | order among siblings, written for a whole sibling list at a time by drops and new folders. Unranked siblings go after ranked ones. |
| `settings` | `{ autoFolders?: bool, mirrorIslands?: bool }` | footer switches; missing = on. |
| `declined` | `{ [ticketKey]: true }` | tickets never to get an automatic folder again. |
| `snapshot` | `{ savedAt, tabs: [{ url, title, parent, rank? }] }` | the tree for the next session; see Restarts. |
| `log`, `changes` | arrays of events (last 200 / 100) | for the report. |

`chrome.storage.session`, emptied by a browser restart **and by an extension reload**:

| key | meaning |
|---|---|
| `sid` | set by the first worker of a session. When it is missing, the worker restores the tree. |
| `mirror` | `{ "<folderId>\|<windowId>\|<workspaceId>": groupId }`: which island mirrors which folder. |

The panel's `localStorage` holds per-viewer conveniences only: `view` (`tree` / `log`) and `collapsed` (keys
`<view>:t:<tabId>`, `<view>:f:<folderId>`, `<view>:ws:<workspaceId>`).

A tab row that is folded has a key with a tab id, and tab ids change on restart, so tab rows unfold after one.

## Commands (panel → background)

`chrome.runtime.sendMessage({ type, ... })`. The reply is `{ ok: true }` or `{ ok: false, error }`. Commands run one
at a time and wait until the start-up restore is done.

| type | payload | does |
|---|---|---|
| `place` | `nodes: ref[]`, `parent: "root" \| "f:<id>" \| "t:<id>"`, `order: ref[]` | puts tabs and folders under `parent` (folders never under a tab) and writes `order` as the parent's sibling ranks. Tabs taken out of a family folder to `root` add that folder's `key` to `declined`. |
| `newFolder` | `id` (client-made, `[a-z0-9]+`), `parent: folderId \| null`, `name?`, `color?`, `key?`, `auto?`, `items: ref[]`, `order: ref[]` | makes the folder, moves `items` into it (ranked in that order), and ranks the enclosing level by `order`. |
| `renameFolder` | `id`, `name` | empty name → `Untitled`; drops `auto`. |
| `colorFolder` | `id`, `color` | one of the 9 Chromium group colors. |
| `deleteFolder` | `id` | contents move to the nearest surviving ancestor (or the top level); the folder's `key` goes to `declined`. |
| `closeItems` | `tabIds`, `folderIds` | closes the tabs and deletes the folders, without declining. |

A ref is `"t:<tabId>"` or `"f:<folderId>"` (`nodeRef()` in tree.js).

## The background

- **`update(key, fn)`**: every storage write is a queued read-modify-write, because tab events come in bursts. A
  write to `parents`, `folders` or `ranks` schedules a snapshot save (1 s debounce) and a `tidy()` pass (400 ms).
- **Start (`ready`)**. If `storage.session.sid` is missing (new browser session or extension reload), the worker:
  1. restores from the snapshot;
  2. runs the one-time island migration;
  3. saves and tidies.

  Saving and tidying wait for `ready`, so the previous session's snapshot can't be overwritten before it is read.
- **Tab events:**

| event | handling |
|---|---|
| `tabs.onCreated` | record `parents[tab] = openerTabId`, except for tabs born on an internal URL (Ctrl+T, start page, `opera://…`: Opera gives those the active tab as opener). Save, tidy, log. |
| `webNavigation.onCreatedNavigationTarget` | fallback opener for `rel=noopener` links, without overwriting. |
| `tabs.onUpdated` | URL change → save. Ticket key changed (compared with `keyOfTab`) → tidy. `groupId` changed by someone else (not in `ours`) → tidy, which undoes it. Title or favicon change on a background tab → `changes` log. |
| `tabs.onRemoved` | children get the closed tab's place. If it was a ticket's tab, the ticket's next root (`pickRoot`) inherits the place when it has none. Rank dropped. **Skipped when `isWindowClosing`**, so shutting the browser down doesn't wreck the tree or the snapshot. |
| `tabs.onReplaced` | move `parents`/`ranks`/`keyOfTab` to the new id (prerendering). |
| `onMoved` / `onAttached` / `onDetached` | save. |

- **`tidy()`**:
  - builds one tree per `(window, workspace)` scope, skipping pinned and incognito tabs;
  - runs `autoFolders()`. If that changed anything, it stops: the storage change brings another pass;
  - then runs `mirrorNow()`.
- **`autoFolders()`**:
  - `familiesOnTop()` = ticket roots on the top level, plus tickets one level under a keyless top-level tab (a hub);
  - a family with 2+ tabs and a key not in `declined` gets `newFolder({ auto: true, key, name: islandName(key, title), color: colorFor(key) })`, in the family's place, or right after the hub;
  - auto folders with no children in any scope are deleted without declining.
- **`mirrorNow()`**:
  - units = top-level folders with ≥ 2 tabs under them (`tabIdsUnder`);
  - each unit keeps the island recorded in `mirror`. Otherwise it adopts the island holding most of its tabs that no
    other unit took, and failing that it creates one;
  - then it groups the missing tabs, syncs title and color, ungroups every tab that belongs to no unit, and stores
    the new `mirror`;
  - moves go through `move()`, which puts tab ids in `ours` for 3 s so their `groupId` events don't trigger another
    pass;
  - with `mirrorIslands: false`, it ungroups the islands listed in `mirror` and clears it.

## The tree (`buildTree(tabs, parents, folders, ranks)`)

Returns `{ root, nodes: Map<tabId, node>, folderNodes: Map<folderId, node> }`. A node is `{ tab | folder, children,
parent }`. A ticket root has `ticket: { key, title }`. A ticket's own pages have `groupKey` / `groupTitle`.

1. Keys: `ticketKey(tab)` for every tab. Per key, the root is `pickRoot()`: the issue page, else the lowest tab-strip
   index.
2. Where a tab hangs (`up`):
   - a non-root tab of a ticket → the ticket's root;
   - a tab without a key → its explicit place (a tab id, a folder, or `-1` for the top level), else the top level;
   - a ticket root → its own place, else the first place among its other tabs (in tab-strip order). Links inside
     the ticket are skipped. A link to another ticket's tab stands for that ticket's root. A link that would put
     the ticket under itself is skipped.
3. Cycle guards: a tab in a cycle goes to the top level; a folder in a cycle goes to the top level.
4. Children order:
   - by rank (unranked last);
   - then folders before tabs, folders by `created`;
   - then a ticket's own pages first;
   - then tab-strip index.

The panel builds the tree for the current workspace. The background builds one per window × workspace.

## Restarts (`snapshot.js`)

- **The snapshot** lists every tab in `(windowId, index)` order as `{ url (no #fragment), title, parent, rank }`,
  where `parent` is the parent's **position** in the list, a folder ref `"f:<id>"`, `-1`, or `null`.
- **Matching (`matchTabs`)**, after `settled()` has waited for the tab count to hold still for 2 s (at most 30 s):
  - walk the saved list in order and pair each entry with the first unused restored tab of the same URL at or after
    the last match, else any unused one of that URL;
  - then, for each run of unmatched entries between two matched neighbours, pair them one to one with the unmatched
    restored tabs in between, if the counts are equal (this catches redirects on reload).
- **`restoredParents`**: a saved parent that didn't come back is replaced by its nearest saved ancestor that did.
  `restoredRanks` moves tab ranks to the new ids; folder ranks are kept as they are.
- **Migration**: the first run with folders (no `folders` key yet) turned each existing island into a top-level folder
  with the island's name (or `Untitled`) and color, placed the top of that island's tree into it, and recorded the
  island in `mirror`, so that nothing moved. It runs once per profile; an empty `folders` object counts as done.

## The panel (`panel.js`)

- **Rendering:**
  - `refresh()` (120 ms debounce, on any tab event or tree/settings storage change) → `load()` → `render()`;
  - `render()` redraws the whole list; that's fine for a few hundred rows;
  - `paused` freezes rendering while dragging, renaming, or showing the copy fallback.
- **The drawn tree** is kept for the handlers: `root`, `nodeByRef` (ref → node), `visible` (refs in drawn order, used
  by Shift ranges).
- **Selection:**
  - a `selection` set of refs plus an `anchor`; `clickSelects()` handles Ctrl, Shift and plain clicks;
  - `selectedNodes()` normalizes: a ticket's page becomes its ticket root, rows under another selected row are
    dropped, and the rest are sorted in drawn order.
- **Drag and drop:**
  - `zoneOf()` splits a row 30/40/30 into before/inside/after;
  - `draggedNodes()` decides what moves: the selection, the row, or the row's ticket;
  - `placement()` checks the drop and builds the `place` message with the parent's complete new child order;
  - the bottom drop zone is appended while dragging.
- **New folders:**
  - the panel makes the folder id itself, so it can put the folder into `order` and open it for renaming;
  - `pendingRename` holds that id until the row is drawn;
  - renaming sends `renameFolder` 250 ms after the last keystroke, and again on blur.
- **Workspaces:** `splitWorkspaces()` picks the workspace whose active tab has the highest `lastAccessed`. Opera
  reports every tab of every workspace in the window, and each workspace has its own active tab.

## Opera, as verified on Opera 135 / Chromium 151 (Windows), 2026-09

- **The tab strip** can't be hidden by an extension. Opera's vertical tabs collapse to a ~35px favicon column that
  stays. With the panel pinned, the layout is: sidebar icons | panel | collapsed strip | page.
- **The sidebar panel:**
  - `sidebar_action` in an MV3 manifest works, through `opr.sidebarAction` (badges, icon, panel, title, onFocus/onBlur);
  - there is no `open()`, so the panel can't be opened from code;
  - `chrome.sidePanel` and `chrome.sidebarAction` don't exist;
  - when not pinned, the panel covers the page.
- **Islands are Chromium tab groups:**
  - `chrome.tabGroups` and `tabs.group` / `ungroup` / `tabGroups.update` all work;
  - Opera shows an island without a title as "Tab island N", but its `title` is `''`;
  - **Opera keeps no one-tab islands**: grouping one tab does nothing, and an island down to one tab is dissolved;
  - a tab opened from a tab in an island joins that island natively.
- **Workspaces:**
  - `tabs.query` returns the tabs of every workspace;
  - each tab has `workspaceId` / `workspaceName`;
  - each workspace keeps its own `active: true` tab.
- **Openers:**
  - `openerTabId` is ephemeral: it is gone after session restore and when the opener closes, sometimes within
    seconds;
  - Ctrl+T tabs and browser pages get the active tab as opener, which is meaningless.
- **Other tab fields**: there is also `splitViewId` (Opera's split screen), unused so far.
- **Title flapping**: messengers pinned in the browser can change their title and favicon every second (unread
  counters).
- **Not available**: `tabs.hide` and `sessions.setTabValue` are Firefox-only, so tabs can't be hidden and nothing
  can be stored on a tab.
- **Unpacked extension ID**: it comes from the folder path, and storage belongs to the ID. **Moving or renaming
  `probe/` starts the extension with empty storage** (folders, placements, order lost). Adding a manifest `key`
  changes the ID once too.
- **`storage.session`** is cleared by an extension reload, so a reload also runs the restore from the snapshot.
  That is harmless: the ids are the same.
- **The service worker** may be stopped at any time. In-memory state (`ours`, `keyOfTab`, timers) is only a
  short-lived optimization; anything lasting is in storage.

## Tests

`npm install` once, then `npm test` (`node --test tests/*.test.js`; each file runs in its own process).

- `tests/helpers/opera-fake.js` is a fake of the Opera APIs the background uses: tabs, islands that vanish when
  empty, storage, events. `open()` opens a tab, `close()` closes one, `setGroup()` imitates a change made in Opera,
  and `ask()` sends a panel command.
- `tests/helpers/panel-env.js` loads `panel.html` + `panel.js` into jsdom with a fake API and records the messages
  the panel sends. Its helpers `click` / `drag` / `fire` / `key` / `selected` look rows up by text.
- `tests/helpers/check.js`: `check(label, ok)` prints PASS/FAIL and fails the file on FAIL.

| file | covers |
|---|---|
| `titles.test.js` | keys, title cleanup, page kinds, labels, names |
| `tree.test.js` | folders, placements, tickets, order, cycles |
| `snapshot.test.js` | snapshot and restart matching, redirects, lost parents |
| `background.test.js` | island migration, mirror, folder commands, ticket heir, mirror off |
| `autofolders.test.js` | automatic folders, hubs, declines, closing a selection |
| `restart.test.js` | two sessions, shutdown guard, restore with folders and order |
| `panel-dnd.test.js` | drawing, drop zones and their messages, folder actions |
| `panel-selection.test.js` | Ctrl/Shift/anchor, selection bar, dragging a selection |

Everything is tested against fakes, never against real Opera. After a change, ask the repo owner to reload the
extension and look, or to paste **Copy report**. The panel tests find elements by id and class (`#list .row`,
`.title`, `.dot`, `#selbar`, `#sel-close`, `input.rename`, `.drop-zone`…) and by row text. A redesign that changes
them has to update the helpers and tests too.
