# TabTree: what it does

Everything the extension does today, from the user's side. How it works inside is in
[ARCHITECTURE.md](ARCHITECTURE.md); what the panel looks like is in [UI.md](UI.md).

## Setup

1. `opera://extensions` → developer mode → **Load unpacked** → the `probe/` folder.
2. The extension shows up in Opera's sidebar (the icon column on the left). Open its panel and **pin** it, so the
   panel sits next to the page instead of covering it.
3. Opera's own tab strip can't be hidden by an extension. Turn on Opera's vertical tabs (Settings → Browser → Tabs)
   and collapse them: the horizontal strip disappears and a narrow column of favicons (~35px) stays between the panel
   and the page.
4. Turn off Opera's automatic Tab Islands: the extension manages islands itself and undoes other changes.

## The panel at a glance

Top to bottom:

- **Search field** (`/` focuses it).
- **Tree | Log** switch and **+ Folder**.
- **Pinned tabs**: a row of favicon buttons.
- **The list**: the tree of folders and tabs.
- **Selection bar**, only while rows are selected: `N selected: …`, **→ Folder**, **Close**, **✕**.
- **Footer**: counters (`32 tabs · 5 folders · 12 tickets`), **Auto-folders** and **Islands** switches, **Copy report**.

The panel shows the current window and the Opera workspace in use.

## Where a tab goes in the tree

- **Opened from another tab** (a link, middle click, `target=_blank`, `window.open`): it hangs under that tab. The
  link is recorded the moment the tab opens, because Opera forgets it within seconds.
- **Ctrl+T, the start page, browser pages** (`opera://settings`, `opera://extensions`…): top level.
- **Pinned tabs** are not in the tree; they are the row of icons above it.
- **Closing a tab** moves its children up one level, into the closed tab's place.
- **Moved by hand** (drag and drop, see below): stays where it was put, until moved again.

### Tickets

A tab belongs to a ticket when its title or URL path carries a tracker key such as `PROJ-123`. Query strings don't
count, so a board URL with `?selectedIssue=PROJ-1` is not that ticket's page. Look-alikes such as `UTF-8`, `ISO-…`,
`SHA-256`, `CVE-2024` are ignored.

- **The ticket's root** is its Jira issue page (`[PROJ-123] …` in the title, or `/browse/PROJ-123`). When that page
  isn't open, the root is the ticket's first tab in the tab strip.
- **The ticket's other tabs** (merge requests, pipelines, the same MR's `/diffs`…) always hang under the root,
  wherever the root is. A new MR of a ticket that lives in a folder therefore lands in that folder, even when it was
  opened from a chat.
- **Tickets nest.** A ticket opened from another ticket's tab becomes a child of that ticket's root, so
  initiative → epic → task → MR reads as one branch. A ticket's own pages come first under it, sub-tickets after
  them.
- **Hubs.** A page without a key that tickets were opened from (an MR list, a board) keeps them as its children.
  Automatic folders can pull them out, see below.
- **Where the whole ticket sits:** its root's own place; if the root has none, the place of the first of its other
  tabs.
- **Closing the root:** the ticket's next root (its Jira page, else its first tab) takes over that place, so the
  ticket doesn't fall out of its folder.
- **A tab that navigates to another ticket** moves with its new key.

## What a row shows

- **Favicon.** If there is none, or it fails to load, the first letter of the host is shown instead.
- **Ticket key** in accent color, only on a ticket's root row.
- **Cleaned title.** The site tail is cut: `- Jira`, `· Merge requests · group / project · GitLab`,
  `- Dashboards - Grafana`, `- Jenkins`, `[Jenkins]`. The key is cut on key rows. `Draft:` / `WIP:` becomes a
  **draft** badge.
- **Page-kind badge:** `MR !42`, `MR !42 · changes|commits|pipelines`, `pipeline #900`, `job #31`, `build #128`.
  Under a ticket, a page whose title only repeats the ticket's shows just its kind (for example, a row reading
  `MR !42`).
- **Other badges:** **dup** on an extra copy of an already open URL, **♪** on a tab playing sound.
- **States:**
  - the active tab is highlighted;
  - tabs Opera unloaded from memory are dimmed;
  - hovering a row shows the full title and URL.
- **Counts:** a collapsed tab row shows `+N` (tabs under it); a folder row shows how many tabs it holds in total.
- **Twisty** `▾` / `▸` on rows that have children. Clicking a tab row's twisty folds it; clicking a folder row folds
  it.

## Folders

- **+ Folder** in the header adds a folder on the top level, after the other top-level folders, and opens its name
  for editing.
- On a folder row, when hovered:
  - **+** adds a folder inside it (and unfolds it);
  - **✎** renames it;
  - **✕** deletes it. What was inside moves one level up; no tab is closed.
- **Renaming** applies as you type and is kept when the field loses focus. Enter finishes, Esc puts the old name
  back, and an empty name becomes `Untitled`.
- **The colored square** switches to the next of nine colors: grey, blue, red, yellow, green, pink, purple, cyan,
  orange. They are the colors Opera islands can have.
- Folders nest to any depth, and a folder can't go under a tab. Unless the order was set by hand, folders come
  before tabs on a level.
- **→ folder** on a top-level ticket (on hover) makes a folder named after the ticket (`PROJ-123 Summary…`), in the
  ticket's place, with the whole ticket inside.

## Automatic folders

A ticket family on the top level gets a folder of its own once it has a second tab. The family is a ticket with
everything under it. The folder is named after the ticket, colored by its key, and created in the family's place.

- A ticket hanging from a hub on the top level qualifies too. Its folder goes right after the hub, and the family
  leaves the hub.
- If you **delete** such a folder, or **drag the family out** of it to the top level, the extension remembers that
  ticket and never makes a folder for it again.
- An automatic folder that becomes **empty** disappears. A **renamed** one counts as yours and stays even when
  empty.
- The **Auto-folders** switch in the footer turns this off.

## Islands (Opera's tab groups) mirror the folders

- Every **top-level folder with two or more tabs** is shown in Opera's own tab strip as an island with the folder's
  name and color. The island holds every tab in the folder, however deep. Nested folders don't get islands of their
  own.
- **A folder with one tab gets no island**: Opera doesn't keep one-tab islands.
- **Every other tab is kept out of islands.** The mirror works one way: an island changed in Opera itself (tabs
  dragged in or out, a rename) is put back to match the folders.
- Islands never span windows or workspaces. A folder with tabs in two of them gets one island in each.
- The **Islands** switch turns the mirror off and releases the islands the extension made.

## Drag and drop

Any tab row or folder row can be dragged. Where it lands depends on where it is dropped:

| Drop on | Result |
|---|---|
| upper edge of a row (top 30%) | before that row, on the same level |
| lower edge of a row (bottom 30%) | after that row, on the same level |
| middle of a row | inside it: into the folder, or under the tab, as its last child |
| the zone shown below the list while dragging | last on the top level |

- **A ticket's own page** (an MR under its ticket) can be reordered among that ticket's pages. Dropped anywhere
  else, it takes the **whole ticket** along.
- **A selected row** drags the **whole selection**, keeping its order.
- **Not allowed:** a folder under a tab, or anything into its own branch. The target shows no drop marker.
- Moving between folders moves the tabs between islands too.

## Selection

- **Ctrl+click** adds a row to the selection or removes it, and makes it the anchor.
- **Shift+click** selects every row from the anchor to the clicked row. With Ctrl as well, the range is added to
  what is already selected.
- **The anchor** is the row clicked last without Shift, plain clicks included. With no anchor, Shift+click selects
  just that row and makes it the anchor.
- **A plain click** clears the selection and does the usual thing: opens the tab, or folds the folder.
- **A click on the empty part of the list, Esc, or ✕ on the selection bar** clears the selection and the anchor.
- **The selection bar:**
  - it counts what is selected (`3 selected: 5 tabs, 1 folder`);
  - **→ Folder** puts the selection into a new folder in place of its first row (on the nearest level that can hold
    a folder) and opens the name for editing;
  - **Close** closes every tab in the selection and removes its folders. Closing more than one tab, or any folder,
    needs a second click within 4 seconds; the button then reads `Sure? Close …`.
- **Delete** does the same as Close.
- **How the selection counts:** a selected page of a ticket stands for its whole ticket, and a row inside a
  selected folder or branch counts only once.

## Search

- Typing filters all tabs of the window, other workspaces included. It matches title, URL, ticket key and page kind
  (`mr`, `pipeline`, `jira`).
- Every word must match; case doesn't matter. Try `2931 mr` or `dashboard latency`.
- Results are a flat list. A tab from another workspace carries that workspace's name.
- **↑ / ↓** move the highlight, **Enter** opens the highlighted tab, **Esc** clears the search.

## Closing tabs and duplicates

- **Middle click** on a row closes that tab.
- **✕ N dups** on a folder row closes the extra copies in that folder. Of each URL, the copy kept is the active one,
  else the most recently used.
- Close on the selection bar: see Selection.

## Pinned tabs and other workspaces

- Pinned tabs of the current workspace are the icon row above the tree. Click one to open it.
- Tabs of other Opera workspaces sit in a collapsed `Workspace: <name>` group at the bottom of the tree: a flat list
  that can't be dragged. Switching workspaces in Opera switches the panel to that workspace.

## After a browser restart

Survives:
- the tree: which tab is under which;
- folders and what is in them;
- the order set by hand;
- the islands.

The extension saves the tree as it changes. After a restart, it matches the restored tabs to what it saved by URL,
in tab-strip order. A tab that loads to a different URL (a login redirect) is still matched by its place between
matched neighbours. A tab whose parent didn't come back goes under the nearest ancestor that did.

Does not survive: the folded state of tab rows (a tab's id changes on restart). The folded state of folders does
survive.

## Log view and report

**Log** shows the report live; **Copy report** copies it. The report contains:
- the Opera and Chromium versions;
- the APIs available;
- tab, workspace and folder counts;
- the snapshot state;
- the last 60 events: tab opened (with opener), link target, drop, folder made or deleted, mirror pass, restore;
- the last 30 title and favicon changes of background tabs.

It is meant for debugging: paste it into a session.

## Settings

Both settings live in the footer and are on by default:
- **Auto-folders**: automatic folders for ticket families.
- **Islands**: the island mirror.

## Keyboard and mouse

| Input | Where | Does |
|---|---|---|
| click | tab row | open the tab (clears the selection, sets the anchor) |
| click | folder row | fold / unfold (clears the selection, sets the anchor) |
| click | twisty of a tab row | fold / unfold its branch |
| middle click | tab row | close the tab |
| Ctrl+click | row | add / remove from the selection |
| Shift+click, Ctrl+Shift+click | row | select / add a range from the anchor |
| click | empty part of the list | clear the selection and the anchor |
| drag | row | move (see Drag and drop) |
| click | folder's colored square | next color |
| hover | folder row | **+**, **✎**, **✕** |
| hover | top-level ticket | **→ folder** |
| `/` | anywhere | focus search |
| ↑ ↓ Enter | search | move the highlight, open |
| Esc | anywhere | clear the search and the selection; also closes the report's copy-by-hand box |
| Delete | with a selection | Close the selection (asks first when it is big) |

## Limitations and known gaps

- **Opera's own tab strip** can only be collapsed, not removed, and the extension can't open its panel by itself.
- **One panel per window**, showing that window only.
- **The tab strip order** isn't changed to follow the tree. Islands only make their tabs sit together.
- **Keyboard navigation** of the tree (arrows, Enter on rows) doesn't exist yet.
- **The refusal list for automatic folders** can't be seen or edited in the UI.
- **Title and favicon changes of background tabs** are only logged. The planned "changed while you weren't looking"
  marker is not built.
- **Hover-only buttons** are easy to miss.
