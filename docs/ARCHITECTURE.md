# TabTree: how it works

What the extension does from the user's side is in [FEATURES.md](FEATURES.md). This file is for changing it.

## Pieces

```
Opera, Chrome or Edge: tabs, islands (tab groups), Opera's workspaces
        │  tab events                          ▲ tabs.group / ungroup, tabGroups.update
        ▼                                      │
  probe/background.js  (MV3 service worker) ───┘
        │  owns every write to the tree        ▲ commands: place, newFolder, …  (runtime.sendMessage)
        ▼                                      │
  chrome.storage.local  ──── onChanged ───▶  probe/panel.js  (the sidebar or side panel page: a view)
```

- `manifest.json`: MV3, Opera's. Declares `sidebar_action` (Opera's own sidebar API; Opera has no `chrome.sidePanel`),
  a module service worker, and the permissions `tabs`, `webNavigation`, `storage`, `tabGroups`, `clipboardWrite`,
  `alarms`. Chrome and Edge get a manifest of their own made from it (see Packages for the stores).
  `optional_host_permissions` (`https://*/*`, `http://*/*`) grants nothing by itself: Settings › Statuses asks
  Opera for one site's origin at a time, so no work host is ever written into the repo.
- `background.js`: the only writer of the tree.
  - Records openers when tabs open.
  - Handles the panel's commands.
  - Saves a snapshot and restores it after restarts.
  - Runs `tidy()`: automatic folders, then the island mirror.
  - Keeps the event log.
- `tree.js`: pure. `buildTree()` turns tabs + stored placements into the tree, including the ticket rules, the
  order and the cycle guards.
- `titles.js`: pure. Ticket keys, title cleanup, page kinds, row labels, folder names and colors for tickets, and
  which open tab shows a page (`pageIdentity()`, `tabToReuse()`).
- `snapshot.js`: pure. Snapshot format and matching restored tabs back to it.
- `backup.js`: pure. The backup file: `backupOf()` writes it, `readBackup()` checks one (see Backups).
- `browser.js`: pure. `browserOf(userAgent, opr)`: Opera, Chrome or Edge, with the words the panel uses there
  (island or tab group), whether it has workspaces, its setup steps, and where its version is in the user agent.
- `panel.html` / `panel.css` / `panel.js`: the UI.
  - Reads tabs and storage, draws the tree, handles search, selection, menus and drag and drop.
  - Turns every change into a command for the background. It never writes the tree itself; it writes only
    `settings` and `wallpaper`, and acts on tabs directly for close, reload and unload.
  - Also draws Settings, the Log view and the setup guide, builds the diagnostics report, and draws the wallpaper.
- `icons.js`: the panel's 27 icons as SVG shapes, and `icon(name)`, which clones a cached `<svg>`.
- `wallpaper.js`: pure. The wallpaper's colors from a small sample of its pixels: `tonesOf()` and `wallTokens()`.
- `statuses.js`: pure. What the panel shows for a status: `rowStatus()` (a row's marks, lozenge, line, finished,
  stale, changed), `summaryOf()` (a branch's failed and running), `barOf()` (the status bar), `statusWords()` (search),
  `cardOf()` (the details card's content), and `MARKS` (a state's icon and color class).
- `integrations.js`: statuses from Jira, GitLab and Jenkins. `detectSites(tabs, limit)` finds the sites behind the
  tabs with their pages; `probeSite(site)` is the Test; `pollSites()` is one round of the watch; `watchedOf(tab)` and
  `statusLines()` read what the watch keeps about a tab. Pure apart from `fetch`, which the tests pass in.
- `icons/`: generated PNGs (16, 32, 48, 128), the extension's own icon.

No build step and no runtime dependencies: `probe/` is loaded as it is. `package.json` is for the tests (jsdom) and
for `npm run pack`, which copies `probe/` and writes each browser's manifest (see Packages for the stores).

## Stored data

`chrome.storage.local`:

| key | shape | meaning |
|---|---|---|
| `parents` | `{ [tabId]: number \| "f:<folderId>" \| -1 }` | where a tab is placed: under a tab, straight in a folder, or on the top level by hand. Written when a tab opens (its opener) and by drag and drop. Ignored for a ticket's non-root pages, which always hang under the ticket's root. |
| `folders` | `{ [id]: { name, color, parent: id \| null, created, key?, auto? } }` | folder ids are stable across restarts (base36 time + random). `key` = the ticket a family folder was made for; `auto` = made automatically (dropped on rename). |
| `ranks` | `{ ["t:<tabId>" \| "f:<folderId>"]: number }` | order among siblings, written for a whole sibling list at a time by drops and new folders. Unranked siblings go after ranked ones. |
| `settings` | `{ autoFolders?: bool, mirrorIslands?: bool, reuseTabs?: bool, statuses?: bool, dimFinished?: bool, markChanged?: bool, onboarded?: bool, setup?: { pin?, tabs?, islands?, left?: bool } }` | the Settings switches (missing = on), written by the panel, and by `importTree`. `onboarded` = the setup guide was dismissed with Got it; `setup` = its steps ticked by hand, by the ids in browser.js (`pin`, `tabs`, `islands` in Opera; `pin`, `left` in Chrome; `pin`, `tabs` in Edge). `mirrorIslands` stands for tab groups too. |
| `wallpaper` | `{ source: "file" \| "none", name, dataUrl, width, height, w, h, bytes, tones: { vivid, dark, mean }, x, dim, blur, accent: "blue" \| "wallpaper" }` | the picture behind the panel with its settings (Settings › Background), written by the panel, and by `importTree`. `width`/`height` are the file's size, `w`/`h` and `bytes` the stored JPEG's; `tones` are `[r, g, b]` colors from `tonesOf()`; `x` (0–100), `dim` (0–100), `blur` (px). `source: "none"` keeps the picture but doesn't draw it. A key of its own, so that a slider's change reloads no tree (see The wallpaper). |
| `declined` | `{ [ticketKey]: true }` | tickets never to get an automatic folder again. Shown in Settings › Never for; `allowAutoFolder` removes one. |
| `apiProbe` | `{ [site base]: { kind, origin, t, results: [{ name, ok, text }] } }` | the background's last answers of the statuses probe, for Settings and the report. Written by the background. |
| `status` | `{ sites: { [base]: { kind, ok, error? } }, tickets, mrs, pipelines, jobs, builds, projects }` | what the watch keeps (see The statuses watch). Written by the background, only when something changed. |
| `snapshot` | `{ savedAt, tabs: [{ url, title, parent, rank? }] }` | the tree for the next session; see Restarts. |
| `log`, `changes` | arrays of events (last 200 / 100) | for the report. |

`chrome.storage.session`, emptied by a browser restart **and by an extension reload**:

| key | meaning |
|---|---|
| `sid` | set by the first worker of a session. When it is missing, the worker restores the tree. |
| `mirror` | `{ "<folderId>\|<windowId>\|<workspaceId>": groupId }`: which island mirrors which folder. Chrome and Edge have no workspaces: the key ends in `\|`. |
| `watch` | the statuses watch's memo: `due` (`"<map> <id>"` or `"site <base>"` → when it is asked again), `me` (Jira site → the session's accountId), `checked` (site → when it was last asked). |

The panel's `localStorage` holds per-viewer conveniences only: `view` (`tree` / `log`; Settings isn't remembered)
and `collapsed` (keys `<view>:t:<tabId>`, `<view>:f:<folderId>`, `<view>:ws:<workspaceId>`). "Later" on the setup
guide is kept in memory only, so the guide comes back when the panel is opened again.

A tab row that is folded has a key with a tab id, and tab ids change on restart, so tab rows unfold after one.

## Commands (panel → background)

`chrome.runtime.sendMessage({ type, ... })`. The reply is `{ ok: true }` (with the command's answer, if it has one) or
`{ ok: false, error }`. Commands run one at a time and wait until the start-up restore is done.

| type | payload | does |
|---|---|---|
| `place` | `nodes: ref[]`, `parent: "root" \| "f:<id>" \| "t:<id>"`, `order: ref[]` | puts tabs and folders under `parent` (folders never under a tab) and writes `order` as the parent's sibling ranks. Tabs taken out of a family folder to `root` add that folder's `key` to `declined`. |
| `newFolder` | `id` (client-made, `[a-z0-9]+`), `parent: folderId \| null`, `name?`, `color?`, `key?`, `auto?`, `items: ref[]`, `order: ref[]` | makes the folder, moves `items` into it (ranked in that order), and ranks the enclosing level by `order`. |
| `renameFolder` | `id`, `name` | empty name → `Untitled`; drops `auto`. |
| `colorFolder` | `id`, `color` | one of the 9 Chromium group colors. |
| `deleteFolder` | `id` | contents move to the nearest surviving ancestor (or the top level); the folder's `key` goes to `declined`. |
| `closeItems` | `tabIds`, `folderIds` | closes the tabs and deletes the folders, without declining. |
| `allowAutoFolder` | `key` | removes the key from `declined` and schedules a tidy pass, so a family that qualifies gets its folder right away. |
| `openTab` | `url` (http or https), `parent`: a tab id, or -1 for the top level | opens the page in a new tab and puts it under `parent`: the URL is kept in `placing` until `tabs.onCreated` reports the tab, which then takes that parent instead of its opener, and the parent is set again once `tabs.create` returns. The details card's **Open pipeline** and **Sign in** use it. |
| `importTree` | `backup`: a file's contents, as parsed | Settings › Import (see Backups). Answers `{ folders, matched, saved }`: folders taken in, and how many of the file's tabs were found open. `not a TabTree backup` when `readBackup()` refuses it. |

A ref is `"t:<tabId>"` or `"f:<folderId>"` (`nodeRef()` in tree.js).

**Queries** change no tree and run beside the commands' queue, without waiting for it or for the restore, so that a
slow site can't hold up a drop. Their reply carries the answer.

| type | payload | answers |
|---|---|---|
| `probeApi` | `site` (from `detectSites()`) | `{ ok: true, kind, origin, t, results }`, and keeps it under `apiProbe`. Only `jira`, `gitlab` and `jenkins` sites with an http(s) base. |
| `retrySite` | `base` | ends the site's rest and runs a round now; `{ ok: true }`. |

## The statuses probe

- **Requests** (`ask()` in integrations.js): `credentials: 'include'`, so the browser's cookies for the site go
  along; `redirect: 'manual'`, because an API that redirects is sending to a login page or an auth proxy;
  `Accept: application/json`; 8 s timeout. All checks of a site run at once.
- **What is asked:**
  - Jira (`/rest/api/3`): `myself`; `issue/<key>?fields=status`; `search/jql` with `key in (…)` (the old `search` is
    switched off on Jira Cloud); `POST issue/bulkfetch` with `X-Atlassian-Token: no-check`, which Jira wants from a
    POST made with a session;
  - GitLab (`/api/v4`): `user`; `projects/<path>/merge_requests/<iid>` and its `approvals`; `pipelines/<id>`;
    `jobs/<id>`. The project path comes from the page's URL, before `/-/`;
  - Jenkins: `whoAmI/api/json` (anonymous means the session didn't come along); `<build>/api/json?tree=…`.
- **Answers** read as `{ name, ok, text }`: a short text from the JSON, or why not (HTTP status with the server's own
  message, a redirect, a web page instead of JSON, a network error, a timeout, JSON of another shape).
- **Two places.** The panel runs the same checks itself and keeps its answers in memory (`panelProbes`), so that the
  report shows whether the background and the panel differ. Access comes from `chrome.permissions.request`, which
  has to be called right in the click; `load()` reads what is granted with `permissions.getAll()`, and
  `permissions.onAdded` / `onRemoved` refresh the panel.

## The statuses watch

- **When:** an alarm (`statuses`, every 30 s) runs while at least one site is connected (`keepWatching()`, again on
  `permissions.onAdded` / `onRemoved`). A tab's new URL, a new connection and a change of `settings` run a round 3 s
  later (`watchSoon()`). Rounds don't overlap.
- **A round** (`watchNow()` → `pollSites()`): the connected sites from `detectSites(all tabs, Infinity)`; for each,
  only what is due is asked, 4 requests at a time per site. What isn't due, or can't be asked, is carried over from
  the last `status`. Pages no longer in any tab drop out.
- **Keys:** tickets by key; merge requests, pipelines and jobs by their page's URL without the tail
  (`https://gitlab.example.com/group/app/-/merge_requests/42`), the same as `watchedOf(tab)` gives; Jenkins builds and
  jobs (`projects`) by their URL. Every value has `t0`, when it was first known, and `t`, when it last changed: the
  same answer keeps the old value, so that `status` is written only on a change. `t > t0` and `t` after the tab's
  `lastAccessed` is what the panel calls changed while you were away. Values are compared with `canon()` (JSON with
  sorted keys), because stored objects come back with their keys sorted. `status.format` (`STATUS_FORMAT`, 2) marks
  statuses kept since that comparison; older ones go through `forgetChanges()` once (`t0 = t`), since a plain JSON
  comparison had seen a change at every round.
- **Shapes:**
  - ticket `{ name, category: new | indeterminate | done, since, assignee: { name, me } | null }`;
  - merge request `{ state, draft, merge, conflicts, threadsResolved, approved, approvalsLeft, approvedBy, pipeline }`;
  - pipeline `{ id, status, warnings, startedAt, finishedAt, duration, stages: [{ name, status, done, total, failed:
    [names], running: [{ name, startedAt }] }], jobs: { total, success, failed, running, pending, skipped, manual,
    canceled, warnings }, failed, running }`;
  - job `{ status, name, stage, allowFailure, pipelineId, startedAt, finishedAt, duration }`;
  - build (and a Jenkins job's last build) `{ number, building, result, startedAt, estimate, duration, job, recent:
    [{ number, result, startedAt, duration }] }`.
- **Requests:**
  - Jira: `myself` once per session and site (`memo.me`), then `POST issue/bulkfetch` for up to 100 due keys at once
    (`status`, `assignee`, `statuscategorychangedate`); keys Jira doesn't know are dropped;
  - GitLab: a merge request (`head_pipeline` included), its `approvals` while it is open, and its pipeline's
    `jobs?per_page=100`, asked again only for another pipeline, a changed status, or one still running; a pipeline
    tab: the pipeline and its jobs; a job tab: the job;
  - Jenkins: one request per Jenkins job, `<job>/api/json?tree=name,builds[number,result,building,timestamp,
    estimatedDuration,duration]{0,6}`: a build tab's build is found in it (else asked by itself), a job tab takes the
    newest; the builds before it go into `recent`.
- **Stages** come from the jobs in id order; a stage is running if a job runs, failed if a job failed that may not,
  pending, canceled, skipped, manual, else success.
- **Cadence** (`CADENCE`): 30 s while running or pending (GitLab's `created`, `waiting_for_resource`, `preparing`,
  `pending`, `running`; Jenkins `building`), 2 min while open (open merge requests, tickets not done, Jenkins jobs),
  15 min once over. A 403/404/410 drops the page for 15 min; another error keeps the old value and asks again in 2 min.
- **A site in trouble:** 401, a redirect, or a web page instead of JSON → `signed out`; a network error or timeout →
  `offline`. The rest of that site's round is carried over, `status.sites[base]` says so, and the site rests 5 or 2
  min (`memo.due["site <base>"]`). `memo.checked[base]` is when it last answered, so its statuses are as of then.
  A page of a signed-out site that finishes loading (`afterSignIn()`) ends its rest, and so does `retrySite`.
- **The switch** `settings.statuses === false` makes the rounds see no site, which empties `status`.

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
| `webNavigation.onCommitted` | the first main-frame commit of a tab created in the last 15 s (`fresh`): logged as `opened` unless it came from a link. When Chromium marks it `start_page` (a page opened from outside the browser, as an address on the command line), the session is older than 30 s (`sid`), and `reuseTabs` is on: `tabToReuse()` finds the tab that shows the same page; it gets the link's URL and comes forward (its window focused), and the new tab closes (`reused` in the log). Without such a tab, the new one goes to the top level. |
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

## Backups (`backup.js`)

Settings › Backup. The file is JSON: `{ tabtree: 1, savedAt, folders, ranks, declined, settings, wallpaper?, tabs }`.

- **`backupOf()`** (the panel's **Export**): `folders` and `declined` as stored; `ranks` of folders only (tab ranks
  go with the tabs); `settings` without `onboarded` and `setup`, whose steps differ from browser to browser; the
  `wallpaper` when it has a picture; `tabs` = `snapshotOf()` of every tab in every window, as a restart keeps them.
  The panel reads storage and `tabs.query({})` itself and saves the file through `<a download>` with a `blob:` URL,
  so no `downloads` permission is needed.
- **`readBackup()`** takes nothing on trust, since a file may come from anywhere: `tabtree` must be 1 and `tabs` a
  list. Folders need `[a-z0-9]+` ids; a name is cut to 200 characters (empty → `Untitled`), a color outside the nine
  becomes grey, a parent that isn't in the file becomes the top level, and `key` / `auto` stay only when they are a
  ticket key / `true`. Ranks of folders in the file, ticket keys in `declined`, the six boolean switches, and a
  wallpaper with a `data:image/` URL, `tones` and its numbers are kept. A tab keeps its place in the list (positions
  are parents), with a parent that is `-1`, a position in the list, or a folder in the file, else `null`.
- **`importTree`** (background): `matchTabs()` against every open tab, as after a restart; then `folders` = the
  file's; `parents` keep the entries of tabs not placed in a folder that is gone, and take `restoredParents()`;
  `ranks` keep tab ranks, take the file's folder ranks and `restoredRanks()`; `declined` and `settings` are merged
  with the file's; `wallpaper` is replaced when the file has one. It logs `imported`.
- **Why folders are replaced, not merged:** the usual import is into a fresh copy of the extension, whose first start
  has already turned the old copy's islands into folders of its own (`migrateIslands()`). Merging would leave those
  as empty twins. Replaced, their tabs move into the file's folders, and `mirrorNow()` adopts the same islands.
- **`restoredParents()`** stops a chain of parents that comes round on itself; a file could hold one.

## Packages for the stores (`scripts/`)

- `npm run pack` (`scripts/pack.js`) copies `probe/` to `dist/<browser>/` for `opera`, `chrome` and `edge`, writes
  that browser's manifest there, and zips it into `dist/tabtree-<browser>-<version>.zip` with the `zip` command.
  `dist/` is not in git. `dist/chrome/` and `dist/edge/` can be loaded unpacked to try a build.
- `scripts/manifests.js`: `manifestFor(base, target)`. Opera's is `probe/manifest.json` as it is. Chrome's and Edge's
  drop `sidebar_action`, add the `sidePanel` permission, `side_panel.default_path` (`panel.html`), an `action` (the
  toolbar button, with the sidebar's title and icons) and `minimum_chrome_version: 116` (`setPanelBehavior()`).
- The background calls `chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true })` at every start, so the
  toolbar button opens the panel. In Opera there is no `chrome.sidePanel`, and nothing happens.
- `probe/manifest.json` stays Opera's, with no `side_panel` or `action`: the owner's copy loads `probe/` itself, and an
  `action` would put a button that does nothing into Opera's toolbar.

## The panel (`panel.js`)

- **The browser:** `browser = browserOf(navigator.userAgent, globalThis.opr)` (browser.js). Opera's pages have `opr`,
  and Edge names itself `Edg/`. It gives the words for islands or tab groups in the status bar, the folder counts'
  tooltips, Settings (the section is named after the browser), the Log and the report; the setup guide's steps; the
  empty state's `workspace` or `window`; and the version in the report.
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
- **Statuses** (drawn from `statuses.js`):
  - `renderNode()` asks `rowStatus()` for each tab row and `statusParts()` draws it before the row's actions: `.stc`
    with the changed dot, the person dot, the lozenge or the marks (`statusIcon()`), and the `.pbar` line; finished
    rows get `.fin`. `summaryPart()` draws `.sum` on folders and folded rows;
  - `renderStatusSum()` fills `#stsum` in the status bar; `troubleBanners()` goes above the tree; search adds
    `statusWords()` to what it matches;
  - the details card: `hoverCard()` / `leaveCard()` (400 ms in, 200 ms out, on the status or the page kind; the
    wait is kept by row, so that a redraw under a still mouse doesn't restart it), `showCard()` builds it from
    `cardModel()` → `cardOf()` and `cardView()`, `placeCard()` puts it under the status, `updateCard()` redraws it
    with the tree (it finds its row again by ref), `closeCard()` on Esc, a click elsewhere, a scroll that moves the
    list (a redraw's own scroll event doesn't count), a view switch;
  - a drawing with a running line redraws itself 30 s later (`tick`), for the fills that follow the clock.
- **Settings and the guide:** `renderSettings()` builds the Settings view (with `backgroundSettings()` first);
  `guideCard()` draws the setup guide. Settings › Backup calls `exportBackup()`, and `#backup-input` (a hidden file
  input) `importBackup()`, which parses the file and sends `importTree`. Both write `settings` through `setSetting()`, a read-modify-write of the whole
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
- **A page opened from another app** (a link clicked in Claude Code) opens in a new tab whose first navigation
  `webNavigation.onCommitted` reports as `start_page`, as Chromium does for an address on the command line
  (verified 2026-09-30). Links inside the browser report `link`.
- **A tab made by an extension** (`tabs.create`, even with `openerTabId`) gets the tab in view as its opener, as
  a Ctrl+T tab does (seen 2026-09-30: a pipeline opened from a merge request's card landed under the active tab).
  The panel therefore opens tabs through the background's `openTab`, which says where they belong.
- **Stored objects come back with their keys sorted** (Chromium keeps them as sorted dictionaries). Comparing a
  stored value with a fresh one as plain JSON sees a change that isn't there; the statuses watch did, at every
  round, until 2026-09-30. The test fakes return sorted copies too (`tests/helpers/stored.js`).
- **Site access with the browser's session** (the statuses probe, 2026-09-30):
  - `chrome.permissions.request({ origins })` from the sidebar panel's click shows Opera's prompt and grants the
    origin, and `permissions.remove` takes it back;
  - with the origin granted, `fetch(url, { credentials: 'include' })` from the service worker and from the panel
    both carry the browser's cookies: Jira Cloud's REST API, a self-hosted GitLab's API v4 (user, merge request,
    approvals) and a self-hosted Jenkins all answered as the signed-in user, so statuses need no tokens;
  - Jira Cloud also took a session POST (`issue/bulkfetch`) with `X-Atlassian-Token: no-check`, so one request can
    fetch the statuses of every ticket in the tabs.
- **Title flapping**: messengers pinned in the browser can change their title and favicon every second (unread
  counters).
- **Not available**: `tabs.hide` and `sessions.setTabValue` are Firefox-only, so tabs can't be hidden and nothing
  can be stored on a tab.
- **Unpacked extension ID**: it comes from the folder path, and storage belongs to the ID. **Moving or renaming
  `probe/` starts the extension with empty storage** (folders, placements, order lost). Adding a manifest `key`
  changes the ID once too. A copy from a store has an ID of its own, so its storage starts empty: that is what
  Backup is for.
- **`storage.session`** is cleared by an extension reload, so a reload also runs the restore from the snapshot.
  That is harmless: the ids are the same.
- **The service worker** may be stopped at any time. In-memory state (`ours`, `keyOfTab`, timers) is only a
  short-lived optimization; anything lasting is in storage.

## Chrome and Edge

**Verified 2026-09-30** (Chrome and Edge on Windows, loaded unpacked from `dist/`): the toolbar button opens the
panel, and the tree, automatic folders and tab groups work. Edge's sidebar stays on the right, with no setting to
move it; Chrome's side panel moves to the left (Settings › Appearance › Side panel, or a right click on its edge).
Chrome has vertical tabs too, which collapse to a column of icons.

**Assumed, not checked one by one yet:**

- `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` makes the toolbar button open the panel
  (Chrome's side panel, Edge's sidebar), and `tabs.query({ currentWindow: true })` in the panel gives its window.
- `chrome.tabGroups`, `tabs.group` / `ungroup` and `tabGroups.update` work as in Opera. Chrome keeps one-tab groups,
  which the mirror doesn't make anyway. Chrome also saves tab groups (Saved Tab Groups): whether the groups the
  mirror makes and releases pile up there is to be seen.
- `tabs.create({ openerTabId })` keeps the opener it was given (the fake does so); `openTab` places the tab either
  way.
- A new tab (Ctrl+T) gets an internal URL (`chrome://newtab/`, `edge://newtab/`), so its opener is ignored as in
  Opera.
- A page opened from another app commits as `start_page`, as Chromium does.
- `permissions.request()` from a click in the side panel shows the browser's prompt.
- `<a download>` with a `blob:` URL saves a file from the side panel (and from Opera's sidebar panel), and the file
  input opens a picker there.
- The panel's width: Chrome's side panel can't be made as narrow as Opera's sidebar panel.

## Tests

`npm install` once, then `npm test` (`node --test tests/*.test.js`; each file runs in its own process).

- `tests/helpers/stored.js`: `asStored()`, what Opera's storage gives back (a JSON copy with sorted keys); both fakes
  return stored values through it.
- `tests/helpers/opera-fake.js` is a fake of the Opera APIs the background uses: tabs, islands that vanish when
  empty, storage, events. `makeChrome()` fakes Chrome instead: no `workspaceId`, `tabs.create` keeps the opener it is
  given, and `sidePanel.setPanelBehavior()` (`panel.behavior`). `open()` opens a tab, `close()` closes one, `setGroup()` imitates a change made in Opera,
  and `ask()` sends a panel command or query. It fakes Opera's optional permissions (`granted`, `grant()`,
  `revoke()`) and alarms; the network is `globalThis.fetch`, set by the test.
- `tests/helpers/panel-env.js` loads `panel.html` + `panel.js` into jsdom with a fake API. It records the messages
  the panel sends, the tabs it opens, closes, reloads and unloads, the text it copies and the settings it writes
  (`storage.local.set` updates the store and notifies the panel, as Opera does). It fakes Opera's optional
  permissions (`granted`, and `permissions.answer` for the next request) and the network (`fetch`; without it every
  request fails). `onMessage` may answer with `{ reply }`. `browser` (`opera` by default, `chrome`, `edge`) sets the
  user agent and `opr`; files the panel saves are in `downloads` (`{ name, href }`, a `blob:` URL that
  `resolveObjectURL()` reads). Its helpers `click` / `drag` /
  `fire` / `key` / `selected` / `search` look rows up by text; `rightClick` / `more` / `menu` / `hint` / `pick` open
  menus and use them.
- `tests/helpers/check.js`: `check(label, ok)` prints PASS/FAIL and fails the file on FAIL.

| file | covers |
|---|---|
| `titles.test.js` | keys, title cleanup, page kinds, labels, names, which open tab shows a page |
| `reuse.test.js` | links from other apps: the tab that shows the page comes forward at the link's address and the copy closes; links inside the browser, the switch and the first half minute are left alone; a page not open goes to the top level |
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
| `integrations.test.js` | the statuses probe: sites and pages found in tabs, the requests made, how each kind of answer reads |
| `watch.test.js` | the statuses watch's rounds: what is asked and kept, stages and jobs, when each page is due, finished pipelines not asked again, a site signed out or offline, a gone page, closed tabs |
| `watch-background.test.js` | the watch in the background: the alarm, a round on it and right after a connection, only connected sites, the switch, no alarm without sites |
| `open-tab.test.js` | a tab the panel opens hangs where it says, not under the tab in view that Opera gives it as opener |
| `probe-api.test.js` | the `probeApi` query in the background: the answer, what is kept, what is refused |
| `browser.test.js` | which browser by `opr` and the user agent, its words and setup steps; each browser's manifest, and the files they name |
| `backup.test.js` | what Export writes, what Import takes from odd files, a chain of parents in a circle; `importTree` into a fresh copy that turned the old islands into folders: folders replaced, tabs back in place, the islands kept |
| `panel-backup.test.js` | Settings › Backup: Export's file and message, Import sending a file and its message, a file that isn't JSON |
| `chrome.test.js` | the background in Chrome: the side panel's button, a folder mirrored as a tab group without workspaces, `openTab` |
| `panel-chrome.test.js` | the panel in Chrome: the setup guide, Groups in the status bar, folder tooltips, Settings › Chrome and Tab groups, the report and the Log, the search hint |
| `statuses.test.js` | the marks of a merge request by precedence, pipelines, jobs, builds, tickets; unknown, stale, changed; summaries, the status bar, search words, times |
| `panel-statuses.test.js` | statuses in the panel: marks, lozenges and lines in rows, folder and folded summaries, the status bar (search, Close finished), the details card (hover, pin, Open pipeline, a redraw meanwhile), the switches, a signed-out site (banner, stale, Sign in), Settings › Statuses (states, Connect, Retry, Test, Disconnect), the report |

Everything is tested against fakes, never against a real browser. After a change, ask the repo owner to reload the
extension and look, or to paste **Copy report**. The panel tests find elements by id and class (`#list .row`,
`.title`, `.dot`, `#selbar`, `#sel-close`, `input.rename`, `.drop-zone`, `.menu .mi .label`, `.settings`, `.card`,
`.row.hit .crumbs`, `#wall`, `#wp-dim`…), icon-only buttons by their `aria-label`, and rows by their text; UI.md
lists them. A change to them has to update the helpers and tests too. jsdom has no canvas, `createImageBitmap` or
`matchMedia`: the tests store a wallpaper instead of picking one, and see the light theme.
