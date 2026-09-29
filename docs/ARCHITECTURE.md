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
  - Reads tabs and storage, draws the tree, handles search, selection, menus and drag and drop.
  - Turns every change into a command for the background. It never writes the tree itself; it writes only
    `settings` and `wallpaper`, and acts on tabs directly for close, reload and unload.
  - Also draws Settings, the Log view and the setup guide, builds the diagnostics report, and draws the wallpaper.
- `icons.js`: the panel's 27 icons as SVG shapes, and `icon(name)`, which clones a cached `<svg>`.
- `wallpaper.js`: pure. The wallpaper's colors from a small sample of its pixels: `tonesOf()` and `wallTokens()`.
- `icons/`: generated PNGs (16, 32, 48, 128), the extension's own icon.

No build step and no runtime dependencies. `package.json` exists only for the tests (jsdom).

## Stored data

`chrome.storage.local`:

| key | shape | meaning |
|---|---|---|
| `parents` | `{ [tabId]: number \| "f:<folderId>" \| -1 }` | where a tab is placed: under a tab, straight in a folder, or on the top level by hand. Written when a tab opens (its opener) and by drag and drop. Ignored for a ticket's non-root pages, which always hang under the ticket's root. |
| `folders` | `{ [id]: { name, color, parent: id \| null, created, key?, auto? } }` | folder ids are stable across restarts (base36 time + random). `key` = the ticket a family folder was made for; `auto` = made automatically (dropped on rename). |
| `ranks` | `{ ["t:<tabId>" \| "f:<folderId>"]: number }` | order among siblings, written for a whole sibling list at a time by drops and new folders. Unranked siblings go after ranked ones. |
| `settings` | `{ autoFolders?: bool, mirrorIslands?: bool, onboarded?: bool, setup?: { pin?, tabs?, islands?: bool } }` | the Settings switches (missing = on), written by the panel. `onboarded` = the setup guide was dismissed with Got it; `setup` = its steps ticked by hand. |
| `wallpaper` | `{ source: "file" \| "none", name, dataUrl, width, height, w, h, bytes, tones: { vivid, dark, mean }, x, dim, blur, accent: "blue" \| "wallpaper" }` | the picture behind the panel with its settings (Settings › Background), written by the panel. `width`/`height` are the file's size, `w`/`h` and `bytes` the stored JPEG's; `tones` are `[r, g, b]` colors from `tonesOf()`; `x` (0–100), `dim` (0–100), `blur` (px). `source: "none"` keeps the picture but doesn't draw it. A key of its own, so that a slider's change reloads no tree (see The wallpaper). |
| `declined` | `{ [ticketKey]: true }` | tickets never to get an automatic folder again. Shown in Settings › Never for; `allowAutoFolder` removes one. |
| `snapshot` | `{ savedAt, tabs: [{ url, title, parent, rank? }] }` | the tree for the next session; see Restarts. |
| `log`, `changes` | arrays of events (last 200 / 100) | for the report. |

`chrome.storage.session`, emptied by a browser restart **and by an extension reload**:

| key | meaning |
|---|---|
| `sid` | set by the first worker of a session. When it is missing, the worker restores the tree. |
| `mirror` | `{ "<folderId>\|<windowId>\|<workspaceId>": groupId }`: which island mirrors which folder. |

The panel's `localStorage` holds per-viewer conveniences only: `view` (`tree` / `log`; Settings isn't remembered)
and `collapsed` (keys `<view>:t:<tabId>`, `<view>:f:<folderId>`, `<view>:ws:<workspaceId>`). "Later" on the setup
guide is kept in memory only, so the guide comes back when the panel is opened again.

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
| `allowAutoFolder` | `key` | removes the key from `declined` and schedules a tidy pass, so a family that qualifies gets its folder right away. |

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
  - `refresh()` (120 ms debounce, on any tab event or a change of `parents`, `folders`, `ranks`, `settings` or
    `declined`) → `load()` → `render()`;
  - `render()` builds the tree first in every view, draws the pinned row and the status bar (`renderStats()`: the
    counts and a square per island), then the tree (with the setup guide above it, or the empty state), the search
    results, the Log view or Settings. `redraw()` replaces the list's content and keeps its scroll position and the
    focused control (by id). It redraws the whole list; that's fine for a few hundred rows;
  - `paused` freezes rendering while dragging, renaming, a menu is open, or the copy fallback shows; `holding` while
    the pointer holds a slider or the frame in Settings › Background. A render asked for meanwhile sets `missed`,
    and closing a menu redraws only then: a redraw between mousedown and mouseup would swallow the click that closed
    the menu;
  - the parts that stay (the header, the Log/Settings bar, the selection bar, the status bar) are in `panel.html`;
    elements with `data-icon` get their icon when the panel starts.
- **Rows:** `tabRow()`, `renderNode()`, `renderFolder()` and `renderGroup()` build them. A row's depth is its `--d`
  (indent and guides come from it in CSS); `data-ref` is its ref. `labelOf()` gives a tab row's text and page kind
  from `rowLabel()` (titles.js returns the kind in parts, and `kindTag()` draws its icon and number). While
  `renderFolder()` draws a top-level folder that is an island (2+ tabs, mirror on), `rail` holds its color:
  `placeRow()` gives every row drawn meanwhile `isl c-<color>`, the folder's row `head` and the last one `end`.
- **The drawn tree** is kept for the handlers: `root`, `treeNodes` (tab id → node, for search paths), `nodeByRef`
  (ref → node), `visible` (refs in drawn order, used by Shift ranges).
- **Selection:**
  - a `selection` set of refs plus an `anchor`; `clickSelects()` handles Ctrl, Shift and plain clicks;
  - `selectedNodes()` normalizes: a ticket's page becomes its ticket root, rows under another selected row are
    dropped, and the rest are sorted in drawn order;
  - `renderSelBar()` draws the bar; `armed` is the timer of an armed Close (4 s). `disarm()` ends it (Cancel, Esc,
    and any change that hides the bar); the strip that runs down is a CSS animation.
- **Drag and drop:**
  - `zoneOf()` splits a row 30/40/30 into before/inside/after;
  - `draggedNodes()` decides what moves: the selection, the row, or the row's ticket;
  - `placement()` checks the drop and builds the `place` message with the parent's complete new child order;
  - markers: the row gets `drop-before|after|inside`; before and after also move the one `dropLine` element into the
    row, where it takes the row's `--d`;
  - `dragImage()` builds the `.ghost` (favicon or folder glyph, key, title, and the count of a multi-row drag) off
    screen for `setDragImage`, and removes it once the browser has taken its picture;
  - the bottom drop zone is appended while dragging.
- **New folders:**
  - the panel makes the folder id itself, so it can put the folder into `order` and open it for renaming;
  - `pendingRename` holds that id until the row is drawn;
  - renaming sends `renameFolder` 250 ms after the last keystroke, and again on blur;
  - `nodesToFolder(nodes, props)` is shared by → Folder, the menus and `familyToFolder()`: the folder goes in place
    of the first node's branch, on the nearest level that can hold folders. `ticketFolder(node)` gives a ticket's
    name, color and key; without a name the folder opens for renaming.
- **Menus:**
  - one `.menu` element on `body`. `openMenu(items, at, ref)` takes `{ label, icon, hint, key, danger, run }` items
    (`hint` under the label, `key` a shortcut on the right), `{ colors, run }` for the swatch row, and `'-'` between
    groups (falsy items are dropped, so conditions sit inline). It is placed at the pointer, or under the ⋯ button's
    right edge, and flips up when there is no room. The row of `ref` gets `menu-open` (keeps its buttons shown); it is
    looked up after the items are made, because making them may clear the selection and redraw the list;
  - `menuFor(node)`: the selection's menu when the row is part of a selection of 2+, else `folderMenu()` or
    `tabMenu()`, after dropping the selection and moving the anchor to the row;
  - actions: `moveToTop()` (a `place` to `root`), `reload()`, `unload()` (`tabs.discard`, never the active tab),
    `copyText()` (`navigator.clipboard`), `markdownOf()` (a nested list of branches).
- **Search results:** `hitRow()` draws a result with `marked()` (the words found, in `<mark>`) and `crumbs()` (the
  path from `treeNodes`, or where else the tab is). `emptyState()` draws "No tabs match" and the empty workspace.
- **Settings and the guide:** `renderSettings()` builds the Settings view (with `backgroundSettings()` first);
  `guideCard()` draws the setup guide. Both write `settings` through `setSetting()`, a read-modify-write of the whole
  object.
- **Log and report:** `diagnostics()` gathers what both show: versions, counts, the snapshot, the last 60 events and
  30 background changes. `buildReport()` turns it into the plain-text report (`fmtEvent()` per event), `renderLog()`
  into the Log view (`eventRow()`: time, a tag colored by kind from `EVENT_TAGS`, `eventWords()`).
  `writeClipboard()` tries the clipboard API, then `execCommand('copy')`; when both refuse, `copyByHand()` shows the
  report selected in the Log view, paused until Esc.
- **Messages:** `toast(text, { error })` shows one `.toast` in `#toasts`: 2.5 s, or 8 s with **Copy report** for an
  error. `send()` shows an error toast when a command fails.
- **Workspaces:** `splitWorkspaces()` picks the workspace whose active tab has the highest `lastAccessed`. Opera
  reports every tab of every workspace in the window, and each workspace has its own active tab.

## The wallpaper

A picture behind the panel (Settings › Background), stored under `wallpaper`.

- **A key of its own.** `load()` reads `parents`, `folders`, `ranks`, `settings` and `declined`, never `wallpaper`,
  and a change of `wallpaper` calls `loadWallpaper()` instead of `refresh()`: moving a slider redraws no tree, in any
  panel, and the half-megabyte picture is read only when it changes. The background doesn't follow it either (a
  change of `settings` schedules a mirror pass).
- **Picking** (`readImage()`): `<input type="file" accept="image/*">` → `createImageBitmap()` → a canvas at most
  1400 px tall (and 2800 wide) → `toDataURL('image/jpeg', 0.85)`, and at lower qualities (0.78, 0.7, 0.62) while it
  is over 640 KB. A 64×36 copy of the canvas gives the pixels for `tonesOf()`. No network.
- **Colors** (`wallpaper.js`, pure):
  - `tonesOf(rgba)`: `vivid` = the average of the most voted hue bucket (24 buckets of 15°, each also getting half
    its neighbours' votes; only pixels with saturation ≥ 0.3 and lightness 0.2–0.88 vote; null when fewer than 2%
    do), `dark` = the average of the darkest tenth, `mean` = the average of all;
  - `wallTokens(tones, { dark, dim, accent })`: `--scrim` (the dark tone at lightness 0.09 in the dark theme, the
    mean at 0.975 in the light one), `--dim` and `--dim-top` (the light theme adds 0.08; the header's part 0.12
    more), and, for `accent: 'wallpaper'` with a vivid color, `--accent`, `--accent-fg`, `--accent-text` and
    `--sel`/`--sel-hover` in the vivid hue. `--accent-text` is moved away from the ground (the scrim over the
    picture's mean) until it reads at 4.5:1, when it can; in the light theme `--accent` must also carry white text.
    With the owner's picture this gives about `#ee96cc` (dark) and `#b9418a` (light), where the design had
    `#ee94c6` and `#b8418a`.
- **Drawing** (`applyWallpaper()`): `body.wp` switches the CSS tokens to translucent ones (panel.css); `#wall` gets
  the picture, `--x` (its `object-position`), `--blur` and the `blur` class (a filter, scaled 1.08 to hide the
  edges); `#scrim` gets `--dim`/`--dim-top`; `body` gets `--scrim` and the accent tokens. The theme comes from
  `matchMedia('(prefers-color-scheme: dark)')`, and a theme change redraws.
- **Writing** (`saveWallpaper()`): the panel shows the change at once and writes the whole object; sliders and the
  frame write when let go, keyboard changes at once. `wallWrites` counts writes on their way, so that
  `loadWallpaper()` ignores the change events of this panel's own writes; a change from another panel is drawn and
  redraws its Settings.
- **The report** has a line `Wallpaper: image 2560×1440 → 2489×1400, 525 KB, x 12, dim 70, blur 0, accent #ee96cc`
  (or `none`).
- **Opera's own wallpaper, planned.** Opera keeps the chosen theme's id in
  `%APPDATA%\Opera Software\Opera Stable\Default\Preferences` (`themes.selected_id`) and the picture in
  `Opera Stable\themes\<id>.zip`, and no extension API reads either. Following it needs a native-messaging helper: a
  small program installed on Windows and registered for the extension (the `nativeMessaging` permission), which
  reads the id, unpacks the picture and hands it to the panel, to store as `source: 'opera'` next to `'file'`. How
  Opera finds native-messaging hosts is not verified yet.

## Opera, as verified on Opera 135 / Chromium 151 (Windows), 2026-09

- **The tab strip** can't be hidden by an extension. Opera's vertical tabs collapse to a ~35px favicon column that
  stays. With the panel pinned, the layout is: sidebar icons | panel | collapsed strip | page.
- **The sidebar panel:**
  - `sidebar_action` in an MV3 manifest works, through `opr.sidebarAction` (badges, icon, panel, title, onFocus/onBlur);
  - there is no `open()`, so the panel can't be opened from code;
  - `chrome.sidePanel` and `chrome.sidebarAction` don't exist;
  - when not pinned, the panel covers the page;
  - a pinned panel stays on screen when a page goes full screen (a video). Opera hides its own UI but keeps pinned
    panels, and there is no API to close, hide or resize the panel.
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
- `tests/helpers/panel-env.js` loads `panel.html` + `panel.js` into jsdom with a fake API. It records the messages
  the panel sends, the tabs it opens, closes, reloads and unloads, the text it copies and the settings it writes
  (`storage.local.set` updates the store and notifies the panel, as Opera does). Its helpers `click` / `drag` /
  `fire` / `key` / `selected` / `search` look rows up by text; `rightClick` / `more` / `menu` / `hint` / `pick` open
  menus and use them.
- `tests/helpers/check.js`: `check(label, ok)` prints PASS/FAIL and fails the file on FAIL.

| file | covers |
|---|---|
| `titles.test.js` | keys, title cleanup, page kinds, labels, names |
| `tree.test.js` | folders, placements, tickets, order, cycles |
| `snapshot.test.js` | snapshot and restart matching, redirects, lost parents |
| `background.test.js` | island migration, mirror, folder commands, ticket heir, mirror off |
| `autofolders.test.js` | automatic folders, hubs, declines, closing a selection |
| `restart.test.js` | two sessions, shutdown guard, restore with folders and order |
| `panel-dnd.test.js` | drawing (depth, island rails, page kinds), drop markers and zones and their messages, the drag image, folder actions |
| `panel-selection.test.js` | Ctrl/Shift/anchor, selection bar, dragging a selection |
| `panel-menus.test.js` | ✕ and ⋯ on rows, the tab, folder, selection and empty-list menus |
| `panel-settings.test.js` | the setup guide, Settings: switches, Never for, island states, diagnostics; the Log view and the copy-by-hand fallback |
| `panel-search.test.js` | the count line, marked matches, paths under results, menus on results, no matches |
| `panel-bars.test.js` | the status bar's counts and island squares, the pinned row, other workspaces, toasts, armed Close with Cancel and its timeout, the search field's clear button |
| `panel-empty.test.js` | an empty workspace |
| `panel-wallpaper.test.js` | Settings › Background: a stored picture drawn, Dim, Blur, the frame, the accent, None, Remove, another panel's change, the report line |
| `wallpaper.test.js` | the tones of made-up pixels and the tokens made from them: hue, contrast, a grey picture |

Everything is tested against fakes, never against real Opera. After a change, ask the repo owner to reload the
extension and look, or to paste **Copy report**. The panel tests find elements by id and class (`#list .row`,
`.title`, `.dot`, `#selbar`, `#sel-close`, `input.rename`, `.drop-zone`, `.menu .mi .label`, `.settings`, `.card`,
`.row.hit .crumbs`, `#wall`, `#wp-dim`…), icon-only buttons by their `aria-label`, and rows by their text; UI.md
lists them. A change to them has to update the helpers and tests too. jsdom has no canvas, `createImageBitmap` or
`matchMedia`: the tests store a wallpaper instead of picking one, and see the light theme.
