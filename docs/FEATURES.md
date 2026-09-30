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

Until it is dismissed, the **setup guide** above the tree lists steps 2–4; see Setup guide below.

## The panel at a glance

Top to bottom:

- **Header**: the search field (`/` focuses it, **✕** in it clears it) and three icon buttons: **New folder**,
  **Log** and **Settings**.
- **Pinned tabs**: a row of favicon tiles.
- **The list**: the tree of folders and tabs, with the setup guide above it until it is dismissed.
- **Selection bar**, floating above the status bar while rows are selected: `3 selected`, what that is
  (`4 tabs, 1 folder`), **Folder**, **Close** and **✕**.
- **Status bar**: what failed, what runs, what is finished and a site in trouble (see Statuses), then counters (`22 tabs · 4 folders · 4 tickets · +2 in Personal`), then **Islands** with a square in
  the color of each island. A click on Islands opens Settings.

**Log** and **Settings** take the place of the header and the list, under a bar of their own: **←** or Esc goes
back to the tree. Short messages show above the status bar for a moment (see Messages).

The panel shows the current window and the Opera workspace in use. It follows Opera's light or dark theme, and can
show a picture of yours behind the tree (Settings › Background).

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

- **Favicon.** If there is none, or it fails to load, the first letter of the host is shown instead. A folder row
  has a folder glyph in the folder's color in its place.
- **Ticket key** in accent color, only on a ticket's root row.
- **Cleaned title.** The site tail is cut: `- Jira`, `· Merge requests · group / project · GitLab`,
  `- Dashboards - Grafana`, `- Jenkins`, `[Jenkins]`. The key is cut on key rows. `Draft:` / `WIP:` becomes a
  **draft** badge.
- **Page kind**, as an icon and the number: the merge request icon with `!42` (`!42 · changes`, `· commits` or
  `· pipelines` for those views of it), the pipeline icon with `#900`, the job icon with `#31`, the build icon with
  `#128`. The words (`MR !42`) are in its tooltip. Under a ticket, a page whose title only repeats the ticket's reads
  as its kind (a row reading `MR !42`, in a quieter color).
- **Other badges:** **dup** on an extra copy of an already open URL, a sound icon on a tab playing sound.
- **States:**
  - the active tab is filled, with an accent mark at its left edge and its title in semibold;
  - selected rows are tinted in the accent color, and neighbouring selected rows join into one block; the active
    tab keeps its mark when selected;
  - tabs Opera unloaded from memory have a grey favicon and a muted title;
  - hovering a row shows the full title and URL.
- **Counts**, in one pill style: a folder row shows how many tabs it holds in total; a folded tab row shows `+N`
  (tabs under it).
- **Twisty**, a chevron on rows that have children: it points down while the row is open. Clicking a tab row's
  twisty folds it; clicking a folder row folds it.
- **Guides**: a hairline under each ancestor's twisty, so deep branches can be followed.
- **Islands**: a top-level folder that Opera shows as an island has a rail in its color down its rows, from its own
  row to the island's last one, and its count is tinted in that color.
- **On hover**, and while the row's menu is open, the row's buttons take the count's place: a tab row shows **✕**
  (close the tab), **⋯** (its menu, see Menus) and a drag handle; a top-level ticket shows **→ folder**, **✕** and
  **⋯**. A folder row shows **+**, **⋯** and a drag handle.

## Folders

- **New folder** (the folder icon in the header) adds a folder on the top level, after the other top-level folders,
  and opens its name for editing.
- On a folder row, when hovered: **+** adds a folder inside it (and unfolds it); **⋯** opens the folder's menu, as
  does a right click (see Menus).
- **Renaming** (**Rename** in the menu) applies as you type and is kept when the field loses focus. Enter finishes,
  Esc puts the old name back (both keys are shown next to the field), and an empty name becomes `Untitled`.
- **Deleting** (**Delete folder** in the menu): what was inside moves one level up; no tab is closed.
- **The folder glyph** (the colored folder icon) switches to the next of nine colors: grey, blue, red, yellow, green,
  pink, purple, cyan, orange. They are the colors Opera islands can have. The menu shows all nine to pick from.
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
  ticket and never makes a folder for it again. **Settings › Never for** lists these tickets; **✕** on one allows it
  again, and its family gets a folder right away if it qualifies.
- An automatic folder that becomes **empty** disappears. A **renamed** one counts as yours and stays even when
  empty.
- The **Auto-folders** switch in Settings turns this off.

## Islands (Opera's tab groups) mirror the folders

- Every **top-level folder with two or more tabs** is shown in Opera's own tab strip as an island with the folder's
  name and color. The island holds every tab in the folder, however deep. Nested folders don't get islands of their
  own.
- **A folder with one tab gets no island**: Opera doesn't keep one-tab islands.
- **Every other tab is kept out of islands.** The mirror works one way: an island changed in Opera itself (tabs
  dragged in or out, a rename) is put back to match the folders.
- Islands never span windows or workspaces. A folder with tabs in two of them gets one island in each.
- In the panel, an island's folder has a rail in its color down its rows, and the status bar has a square in its
  color. With the mirror off, the status bar reads `Islands off`.
- The **Islands** switch in Settings turns the mirror off and releases the islands the extension made. Settings also
  lists every top-level folder with its island state.

## Drag and drop

Any tab row or folder row can be dragged. Where it lands depends on where it is dropped:

| Drop on | Result |
|---|---|
| upper edge of a row (top 30%) | before that row, on the same level |
| lower edge of a row (bottom 30%) | after that row, on the same level |
| middle of a row | inside it: into the folder, or under the tab, as its last child |
| the zone shown below the list while dragging | last on the top level |

- **Markers:** before or after, a line with a ring where the item will land, at the depth it will land at; inside,
  the row is filled and outlined. The zone at the bottom turns solid while something is over it.
- **The pointer** carries the row's favicon and title (a folder's glyph and name); dragging several rows adds their
  count.
- **A ticket's own page** (an MR under its ticket) can be reordered among that ticket's pages. Dropped anywhere
  else, it takes the **whole ticket** along.
- **A selected row** drags the **whole selection**, keeping its order.
- **Not allowed:** a folder under a tab, or anything into its own branch. The target shows no drop marker, and the
  pointer shows it can't drop there.
- Moving between folders moves the tabs between islands too.

## Selection

- **Ctrl+click** adds a row to the selection or removes it, and makes it the anchor.
- **Shift+click** selects every row from the anchor to the clicked row. With Ctrl as well, the range is added to
  what is already selected.
- **The anchor** is the row clicked last without Shift, plain clicks included. With no anchor, Shift+click selects
  just that row and makes it the anchor.
- **A plain click** clears the selection and does the usual thing: opens the tab, or folds the folder.
- **A click on the empty part of the list, Esc, or ✕ on the selection bar** clears the selection and the anchor.
- **The selection bar**, floating above the status bar:
  - it counts what is selected (`3 selected`, then `5 tabs, 1 folder`);
  - **Folder** puts the selection into a new folder in place of its first row (on the nearest level that can hold a
    folder) and opens the name for editing;
  - **Close** closes every tab in the selection and removes its folders. Closing more than one tab, or any folder,
    asks first: the bar turns red and asks `Close 5 tabs and 1 folder?` with **Close** and **Cancel**, and a strip
    along its bottom runs down over 4 seconds. **Close** then closes them; **Cancel**, Esc, or the 4 seconds
    running out keep them, and the selection too.
- **Delete** does the same as Close.
- **How the selection counts:** a selected page of a ticket stands for its whole ticket, and a row inside a
  selected folder or branch counts only once.
- **Right click** (or **⋯**) on a selected row opens the selection's menu, see Menus.

## Menus

**⋯** on a row (shown on hover) and a **right click** on the row open the same menu. Its items have icons; a hint
under an item says what it takes along. It closes on Esc, a click elsewhere, scrolling, or once an item is used.
↑ ↓ move between its items and Enter uses one. The row keeps its buttons shown while its menu is open.

**A tab:**
- **Close tab**, the same as a middle click. **Close N tabs** when tabs hang under it: the tab and everything under
  it.
- **Put into a new folder**: a new folder in the branch's place, on the nearest level that can hold folders, with the
  tab and everything under it inside. For a ticket (or one of its pages) the whole ticket goes in, and the folder is
  named and colored after it, as with **→ folder**. For any other tab the folder opens for renaming.
- **Move to the top level** (when the tab isn't there): last on the top level. A ticket's page moves its ticket.
- **Copy link**. **Copy links as Markdown** when tabs hang under it: the branch as a nested list,
  `- [PROJ-2 Epic](https://…)`, one level of indent per tree level, folders in bold.
- **Reload** / **Reload N tabs**, and **Unload from memory** / **Unload N tabs**: Opera frees the tab's memory and
  loads it again when it is opened. The tab in view is never unloaded.

**A folder:**
- **New folder inside** and **Rename**;
- **Color**: the nine colors as a row of swatches, the folder's own one ringed;
- **Close N duplicates** when the folder holds extra copies of a URL;
- **Copy links as Markdown** when it holds tabs;
- **Delete folder**: its tabs move one level up.

**The selection** (on a selected row, with more than one row selected):
- **Put N items into a new folder** (as **Folder** on the selection bar), **Move to the top level**,
  **Copy links as Markdown**, **Reload N tabs**, **Unload N tabs**;
- **Close …**, at once: choosing it in a menu is already deliberate, so there is no second click as on the selection
  bar.

A right click on a row outside the selection clears the selection and opens that row's menu.

**The empty part of the list:** **New folder** on the top level.

**A search result** of the current workspace: the tab's menu.

## Search

- Typing filters all tabs of the window, pinned tabs and other workspaces included. It matches title, URL, ticket
  key and page kind (`mr`, `pipeline`, `jira`).
- Every word must match; case doesn't matter. Try `2931 mr` or `dashboard latency`.
- **✕** in the field, while it holds text, clears it.
- Above the results: how many there are (`4 tabs`), and the keys (`↑ ↓ move · ↵ open · Esc clear`).
- A result is the tab's row (favicon, key, cleaned title, badges) with the words found in the title marked. Under it
  is where the tab is:
  - its path in the tree, top down: folders, tickets' keys and other pages' titles
    (`Release 2.4 › PROJ-101 › PROJ-140`), after a square in the top-level folder's color;
  - or `Top level`, `Pinned`, or `Workspace Personal · opens there` for a tab of another workspace, which also
    carries the workspace's name as a badge.
- **↑ / ↓** move the highlight (an accent outline), **Enter** opens the highlighted tab, **Esc** clears the search.
  A click opens a result, a middle click closes it, and a right click opens its menu (tabs of the current
  workspace).
- With nothing found: `No tabs match`, what is searched, and **Clear search**.

## Closing tabs and duplicates

- **Middle click** on a row, or **✕** at its right end (on hover), closes that tab.
- **Close N tabs** in a tab's menu closes the tab with everything under it.
- **N dups** (with a ✕, in warning color) on a folder row, or **Close N duplicates** in its menu, closes the extra
  copies in that folder. Of each URL, the copy kept is the active one, else the most recently used.
- Close on the selection bar or in the selection's menu: see Selection and Menus.

## Pinned tabs and other workspaces

- Pinned tabs of the current workspace are the row of tiles above the tree. Click one to open it. The active one is
  underlined, and a dot marks one playing sound.
- Tabs of other Opera workspaces sit under **Other workspaces** at the bottom of the tree, in a folded group per
  workspace, named after it: a flat list that can't be dragged. Switching workspaces in Opera switches the panel to
  that workspace.
- A workspace with no tabs in the tree shows `No tabs in this workspace` and **New folder**.

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

## Messages

- A confirmation (`Report copied`, `Link copied`, `Links copied`) shows above the status bar for 2.5 seconds.
- An error (`place failed: no answer`, `The clipboard refused`) stays for 8 seconds, in red, with **Copy report**.
- A click on a message dismisses it. A new message replaces the one shown.

## Log view and report

**Log** (in the header) shows the report live:
- a summary: Opera's and Chromium's versions, the APIs (✓ available, ✗ missing), tabs, workspaces, folders,
  placements, the snapshot, and the wallpaper when there is one;
- **Events** or **Background changes**, newest first: each with its time and a tag for its kind (created, link,
  place, folder, mirror, closed, restored, startup, title, favicon).

**Copy report** in the Log view's bar, **Copy** in Settings › Diagnostics, or **Copy report** on an error message
copies the report as plain text. If the clipboard refuses, the Log view shows the report selected, to copy by hand:
Ctrl+C, then Esc. The report contains:
- the Opera and Chromium versions;
- the APIs available;
- tab, workspace and folder counts;
- the snapshot state;
- the wallpaper: its size before and after scaling, its size in storage, and its settings;
- the last 60 events: tab opened (with opener), link target, drop, folder made or deleted, mirror pass, restore;
- the last 30 title and favicon changes of background tabs.

It is meant for debugging: paste it into a session.

## Settings

**Settings** in the header (or **Islands** in the status bar) opens the settings; **←** or Esc goes back. The
switches are on by default.

- **Background**: **None** or **Image file**, a picture of yours behind the tree.
  - **Image file** asks for a picture the first time, and later shows the one picked before. The picture is scaled
    down to 1400 pixels tall and kept in the extension's storage, so it survives restarts. Nothing leaves the
    computer.
  - A thumbnail of the whole picture has a frame over the part behind the panel: drag it sideways, or focus it and
    use ← →, to move the picture.
  - **Change…** picks another picture. **Remove** deletes it; **None** only hides it.
  - **Dim** (70% at first): how strongly a veil covers the picture, so that text stays readable. The veil is the
    picture's darkest tone made very dark, or near white in the light theme.
  - **Blur** (0 to 24 pixels, 0 at first).
  - **Accent**: **Blue**, or **From wallpaper**: the picture's most frequent strong color, made readable on the veil.
    A picture without a strong color keeps blue.
  - Every panel (one per window) shows the same picture, and follows a change made in another one.
- **Tree**
  - **Auto-folders**: automatic folders for ticket families.
  - **Never for**: the tickets that never get an automatic folder (their folder was deleted, or the family was taken
    out of it). **✕** on a ticket allows it again; if its family qualifies, the folder is made right away.
- **Opera**
  - **Islands**: the island mirror.
  - Every top-level folder with its state: `9 tabs · island`, `1 tab · no island, Opera needs 2`,
    `0 tabs · no island`, or `islands are off`.
- **Statuses**: showing them, the connected sites, dimming finished rows, marking changes; see below.
- **Diagnostics**: **Report › Copy** copies the report; **Log › Open** opens the Log view.
- **Setup**: **Setup guide › Show** brings the setup guide back above the tree.

## Statuses of tickets, merge requests, pipelines and builds

The rows show where the work of their tabs stands: a ticket's status, a merge request's pipeline and what keeps it
from merging, a job's or a build's result. The extension reads Jira, GitLab and Jenkins with the browser's own
sign-in: no tokens, it only reads, and nothing leaves the browser. Everything is in **Settings › Statuses**.

### What the rows show

The status sits last in the row, before the count, so statuses line up in one column. Color means finished or needs
you; ink and motion mean still going.

- **A ticket's root row:** a lozenge with the ticket's status in capitals (`IN REVIEW`), outlined for To Do, ink for
  In Progress, green for Done; a person dot in the accent color when the ticket is on you.
- **A merge request** (any of its pages): one mark, whichever comes first of: merged, closed, pipeline failed,
  conflict, pipeline running or waiting, needs a rebase, unresolved threads, approvals missing (`1/2`), ready to merge
  (`ready`, green). A second, smaller mark may come before it for what else blocks it (a rebase beside a failed
  pipeline), and the approvals beside a running pipeline. A draft shows its pipeline's mark.
- **The line under the row** (from the favicon to the right edge): while a pipeline runs, it fills as its jobs finish,
  in two hues of the accent with a soft glow and a highlight sweeping along it; when the pipeline failed, it is full,
  coral to red; a passed one has none. A Jenkins build's line fills by Jenkins' own estimate, with the time left
  (`~6 min`) before its mark.
- **A pipeline tab, a GitLab job tab, a Jenkins build tab:** their mark (passed, failed, running, waiting, manual,
  scheduled, canceled, skipped, passed with warnings, unstable, aborted, not built); a failed job has the red line. A
  Jenkins job's tab shows its last build.
- **Finished rows are dimmed:** merged and closed merge requests, Done tickets (**Dim finished rows** in Settings).
- **Changed while you were away:** a dot before the status (red for a failure, green for a success) when it changed
  after you last looked at the tab; it goes when you open the tab (**Mark what changed while you were away**).
- **Not known yet:** a dashed circle while a connected site is first asked. A page of a site that isn't connected has
  no mark at all.
- **Folders and folded rows** sum up what failed and what runs under them (`✕ 2 ◌ 1`), failed first.
- Below 340px of panel width, the words (`ready`, `~6 min`, the lozenge's name, the status bar's words) give way to
  their icons.

### The details card

Hovering a status, or the page kind beside it (`MR !42`), for 400 ms opens a card; a click on the status pins the card. It closes when the mouse leaves it (unless
pinned), on Esc, a click elsewhere, or scrolling. It answers "what am I waiting for":

- a merge request: its pipeline (running for how long, or failed after how long) with a bar of its jobs, each stage
  with its jobs done of all (`test 4/7 · 1 running`), the failed jobs and the running ones (for how long) under their
  stage; then what the merge waits for (conflicts, a rebase, threads, the pipeline, approvals `1 of 2`) or **Ready to
  merge**; **Open pipeline** opens it in a tab under the merge request;
- a ticket: its lozenge and for how long it has been in that status, who it is on, when the status changed, and how
  many open merge requests hang under it;
- a job: its stage and pipeline, and how it ended (`Failed after 3 min`, how long ago);
- a Jenkins build: when it started, a bar and the time left by the estimate, and the job's last builds with their
  results;
- how fresh it is (`gitlab.example.com · checked 20 s ago`). A site in trouble adds a note that this is the last known
  status, with **Sign in** or **Retry**.

### Around the tree

- **The status bar** starts with what needs you: `2 failed` and `3 running` put `failed` or `running` into the
  search; `2 finished` offers **Close 2 finished tabs** (merged and closed merge requests, Jira pages of Done tickets).
  A site in trouble comes first: `GitLab: sign in` opens the site, `Jenkins: offline` asks it again.
- **A banner above the tree** when a connected site signed out or can't be reached: `Signed out of
  gitlab.example.com. Its statuses are from 14:02. Sign in`. Its statuses stay, dimmed, until it answers again.
- **Search** matches statuses too: `failed`, `running`, `passed`, `merged`, `ready`, `rebase`, `conflict`, `draft`,
  `done`, a Jira status's own name.

### Settings › Statuses

- **Show statuses** (on by default): off stops asking and forgets the statuses.
- **The sites** are the Jira, GitLab and Jenkins sites behind the open tabs:
  - Jira: an issue page (`/browse/PROJ-1`), a site on `atlassian.net`, or a title ending in `- Jira`;
  - GitLab: a merge request, pipeline or job page (`/-/merge_requests/42`), or a title ending in `· GitLab`;
  - Jenkins: a title ending in `[Jenkins]` or `- Jenkins`;
  - any page of a host named after its tool (`gitlab.example.com`, `jira.example.com`, `jenkins.example.com`).
  Nothing about them is kept in the extension's code. A kind with no open page gets a line saying what to open.
- Each site shows how it stands: `Connected · checked 12 s ago · 5 tickets`; `Signed out · last known 14:02` with
  **Sign in**; `Offline · VPN? last OK 13:40` with **Retry**; `Not connected: TabTree may not read this site` with
  **Connect**, which asks Opera to let the extension read that site (Opera asks you).
- **⋯** on a connected site: **Test the connection** and **Disconnect**.
- **Dim finished rows** and **Mark what changed while you were away**, both on by default.

### How it is asked

- **What is kept**, for the pages of the open tabs only:
  - a ticket (any tab whose title or path carries its key, so a ticket shows even when only its merge request is
    open): its status, its category, since when, and who it is on;
  - a merge request: open, draft, merged or closed; why it can't be merged yet; its approvals; its latest pipeline
    with its stages and jobs;
  - a pipeline tab, a GitLab job tab: the same for them;
  - a Jenkins build or job tab: the build's result or progress, and the job's last builds.
- **How often:** every 30 seconds while something runs, every 2 minutes while it is open, every 15 minutes once it is
  over. A page that opens in a tab is asked about within seconds. Pages of closed tabs are forgotten.
- **When a site fails:** signed out (the session expired) or unreachable (no network, VPN off), it is asked again
  after 5 or 2 minutes, and its last statuses stay meanwhile. A signed-out site is asked again as soon as one of its
  pages loads, which is how signing in on the site brings it back; **Retry** asks at once.
- **Test** only reads. It asks the site who you are, then about pages of the open tabs (Jira: a ticket's status, a
  JQL search and a bulk fetch; GitLab: a merge request, its approvals, a pipeline, a job; Jenkins: a build), from the
  background and from the panel, and shows every answer under the site: `✓ Signed in: yes`, or why not
  (`HTTP 401 · not signed in`, `redirected, likely to a login page`, `a web page instead of JSON`, `network error`,
  `no answer in 8 s`).
- **The report** has Test's answers, the connected sites, a summary of the watch, and a line per status.

## Setup guide

Until it is dismissed, a card above the tree lists what to set up in Opera, once:
1. **Pin this panel**: the pin in the panel's title bar keeps it next to the page.
2. **Collapse Opera's tabs**: Settings › Browser › Tabs: vertical tabs, collapsed to a column of icons.
3. **Turn off automatic Tab Islands**: TabTree makes islands from your folders.

- A click on a step ticks it (✓) or unticks it. Opera doesn't tell extensions any of this, so the steps are ticked
  by hand.
- **Got it** hides the guide for good; **Settings › Setup guide › Show** brings it back.
- **Later** hides it until the panel is opened again.

## Keyboard and mouse

| Input | Where | Does |
|---|---|---|
| click | tab row | open the tab (clears the selection, sets the anchor) |
| click | folder row | fold / unfold (clears the selection, sets the anchor) |
| click | twisty of a tab row | fold / unfold its branch |
| middle click | tab row | close the tab |
| right click | row | its menu; on a selected row, the selection's menu (see Menus) |
| right click | empty part of the list | New folder |
| Ctrl+click | row | add / remove from the selection |
| Shift+click, Ctrl+Shift+click | row | select / add a range from the anchor |
| click | empty part of the list | clear the selection and the anchor |
| drag | row | move (see Drag and drop) |
| click | folder glyph | next color |
| hover | tab row | **✕** close, **⋯** menu, drag handle |
| hover | folder row | **+** folder inside, **⋯** menu, drag handle |
| hover | top-level ticket | **→ folder**, **✕**, **⋯** |
| click | step of the setup guide | tick / untick it |
| hover 400 ms | a row's status or page kind | its details card |
| click | a row's status | pin the details card |
| click | `2 failed`, `3 running` in the status bar | search for them |
| click | `2 finished` in the status bar | offer to close them |
| click | **Islands** in the status bar | open Settings |
| click | a message | dismiss it |
| `/` | anywhere | focus search (from Log or Settings too) |
| ↑ ↓ Enter | search | move the highlight, open |
| ↑ ↓ Enter | menu | move between the items, use one |
| ← | Log, Settings | back to the tree |
| drag, or ← → | the frame in Settings › Background | move the picture |
| Esc | anywhere | close the menu, if one is open; else close the details card; else cancel an armed Close; otherwise clear the search and the selection, and go back to the tree from Log or Settings; also closes the report's copy-by-hand box |
| Delete | with a selection | Close the selection (asks first when it is big) |

## Limitations and known gaps

- **Opera's own tab strip** can only be collapsed, not removed, and the extension can't open its panel by itself.
- **Full-screen video**: a pinned panel stays on screen next to a video in full screen. This is how Opera treats
  every pinned sidebar panel, and extensions have no API to hide or close their panel. Workaround: close the panel
  (its icon in Opera's sidebar), or unpin it, before going full screen.
- **One panel per window**, showing that window only.
- **The tab strip order** isn't changed to follow the tree. Islands only make their tabs sit together.
- **Keyboard navigation** of the tree (arrows, Enter on rows) doesn't exist yet.
- **The setup guide can't check its steps**: Opera tells extensions neither whether the panel is pinned nor how its
  tabs and islands are set up, so the steps are ticked by hand.
- **Title and favicon changes of background tabs** are only logged. The planned "changed while you weren't looking"
  marker is not built.
- **Hover-only buttons** are easy to miss; a right click gives the same menu as **⋯**.
- **Statuses** come only from Jira, GitLab and Jenkins, and only for the pages of open tabs.
- **The background picture comes from a file.** Following Opera's own start-page wallpaper needs a helper outside
  the browser (see ARCHITECTURE.md), so it is not offered yet.
