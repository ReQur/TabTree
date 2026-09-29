# TabTree: the panel's UI

The panel as built: where it lives, its layout, tokens, parts and their states, and the wallpaper mode. It follows
the design canvas "TabTree panel redesign" (claude.ai); the places where the build differs from the canvas are listed
at the end. What each control does is in [FEATURES.md](FEATURES.md); where the code is, in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Where the panel lives

- **Place:** a page inside Opera's sidebar on the left. Left to right: Opera's sidebar icons (~40px), **the panel**,
  Opera's collapsed native tab strip (~35px favicon column), then the web page.
- **Size:** the user sets the width by dragging its edge. It works from 260 to 450px (the owner's is ~380px), with
  no horizontal scrolling. It takes the full window height.
- **Opera's title bar:** Opera draws its own bar above the panel with the extension's name (`name` in
  `manifest.json`, now "TabTrees Probe"), a reload button and a pin. It isn't ours to style. The icon in Opera's
  sidebar comes from `probe/icons/`.
- **Theme:** light or dark, following `prefers-color-scheme` (the owner uses Opera's dark theme).
- **Amount:** usually 10–100 tabs, 3–10 folders and trees up to 5–6 levels deep. Titles are long. Density matters:
  the panel competes with the page for width.

## Layout

```
┌──────────────────────────────────────────────────┐
│ [⌕ Search tabs, PROJ-123, mr, jira…   / ] [▭+][∿][≡] │  header: search, New folder, Log, Settings
│ [T] [M] [P•]                                      │  pinned tiles; • = playing sound
├──────────────────────────────────────────────────┤
│ ┌ Set up TabTree ─────────────────────────────┐   │  setup guide, until dismissed
│ │ ✓ Pin this panel …                          │   │
│ └─────────────────────────────────────────────┘   │
│ ⌄ ▰ Release 2.4                            (9)   │  island folder: glyph, rail ┃ down its rows, tinted count
│ ┃ ⌄ ▰ Dashboards                           (2)   │  nested folder
│ ┃ │  (G) Checkout latency                         │  hairline guides per level
│ ┃ ⌄ (J) PROJ-101 Payments initiative              │  ticket root: key + cleaned title
│ ┃ │ ⌄ (J) PROJ-140 Retry policy epic              │
│ ┃ │ │  (F) MR !812                                │  a page that repeats its ticket's title
│ ┃ │ │▌ (F) Backoff tuning     ⑂ !820 [draft]      │  active tab: fill + accent pip, semibold
│ ┃ │ │  (F) Backoff tuning  ⑂ !820 · changes [dup] │
│ ⌄ ▰ Personal                               (1)   │  one tab: no island, no rail
│    (B) Online bank                                │  discarded: grey favicon, muted title
│ ⌄ (F) Merge requests                              │  hub page
│ │  (F) PROJ-160 Rate limiter     ⑂ !830  ✕ ⋯     │  hover: actions in the count's place
│ › (M) Inbox – Mail                         (+3)   │  folded row
│ OTHER WORKSPACES ────────────────────────────     │
│ › ≋ Personal                               (2)   │  other workspace, folded
│                                                   │
│ ┌ 3 selected  4 tabs, 1 folder  [Folder][Close] ✕┐│  selection bar, floating
│ └────────────────────────────────────────────────┘│
├──────────────────────────────────────────────────┤
│ 22 tabs · 4 folders · 4 tickets · +2 in Personal   Islands ■■ │  status bar
└──────────────────────────────────────────────────┘
```

(G), (J), (F), (M), (B), (T) stand for favicons; ▰ for folder glyphs in their colors.

Log and Settings replace the header, the pinned row and the list with a bar (`←`, the title; the Log view adds
**Copy report**) and their own content. The selection bar and messages float over the list's bottom.

## Tokens (`probe/panel.css`)

Light on `:root`, dark under `@media (prefers-color-scheme: dark)`. Text on every ground meets 4.5:1; `--faint` is
for marks only.

| token | light | dark | used for |
|---|---|---|---|
| `--bg` | `#f9f9fb` | `#1b1c21` | panel ground |
| `--raised` | `#ffffff` | `#25272e` | menus, selection bar, cards, focused search |
| `--sunken` | `#f0f1f4` | `#15161a` | search field, pinned tiles, segmented switch |
| `--fg` | `#1c2026` | `#e4e6eb` | text |
| `--fg-2` | `#454c57` | `#b9bec7` | secondary text; a title that reads as its page kind |
| `--muted` | `#656c77` | `#8f949e` | counts, kinds, crumbs, status bar, descriptions |
| `--faint` | `#8f959e` | `#6b707a` | twisties, drag handle, crumb separators |
| `--line` | `#e2e4e8` | `#2e3037` | separators, outlines of raised surfaces |
| `--guide`, `--guide-hi` | `#dcdfe4`, `#b3b8c0` | `#32353d`, `#555a65` | indentation guides; drop zone border, switch off |
| `--hover` | `#eef0f3` | `#25272e` | row and button hover |
| `--current` | `#e2e5ea` | `#2f323b` | active tab fill, pressed buttons, active pinned tile |
| `--sel`, `--sel-hover` | `#dde8fd`, `#d1e0fc` | `#22314d`, `#293b5c` | selected rows, drop inside, menu hover, focus ring |
| `--accent` | `#2f6feb` | `#78a6ff` | active pip, focus border, drop markers, primary button |
| `--accent-fg` | `#ffffff` | `#0f1a33` | text on the accent |
| `--accent-text` | `#1f5fd6` | `#8fb4ff` | ticket keys, sound icon |
| `--chip`, `--chip-fg`, `--chip-line` | `#eceef2`, `#4a515c`, `#d6d9df` | `#2a2c34`, `#b3b8c1`, `#3a3d46` | badges, counts, key caps |
| `--warn`, `--warn-bg` | `#8a5a00`, `#fcefd0` | `#e8b949`, `#3a3016` | dup, N dups, the copy-by-hand banner |
| `--danger`, `--danger-bg`, `--danger-fg` | `#c4312b`, `#fdeceb`, `#fff` | `#f2706a`, `#3d2226`, `#1b1c21` | armed Close, Delete folder, error message |
| `--ok` | `#1f8a57` | `#5fcf98` | available APIs in the Log view |
| `--mark`, `--mark-fg` | `#fde68a`, `#1c2026` | `#594a17`, `#ffe9a8` | matched text in search results |
| `--ring`, `--shadow` | 20% black; soft shadow | 35% black; deeper shadow | glyph edges; raised surfaces |

- **Type:** `"Segoe UI Variable Text", "Segoe UI", system-ui`, 12/16. View titles and empty states 13/600; folders,
  keys and the active tab 12/600; kinds, crumbs, status 11; badges 10/500, counts 10.5/500; section labels 10/600
  caps; log values and times 11 `"Cascadia Mono", Consolas` (`--mono`).
- **Sizes:** rows 24px (`--row-h`), indent 12px per level (`--indent`), twisty 12, favicon and glyph 16, gap in a row
  6; header ~38, status bar 26; icon buttons 26, row actions 20; island rail 3px, active pip 3×14.
- **Radii:** 4 chips (`--r-s`), 6 rows (`--r`), 8 menus and bars (`--r-l`).
- **Folder and island colors**: Opera allows these nine only. Classes `.c-<color>` set `--c`, which the folder
  glyph, the rail, swatches, squares and log tags use. The islands in Opera's strip use Opera's own shades.

| name | hex |
|---|---|
| grey | `#9aa0a6` |
| blue | `#8ab4f8` |
| red | `#f28b82` |
| yellow | `#fdd663` |
| green | `#81c995` |
| pink | `#ff8bcb` |
| purple | `#c58af9` |
| cyan | `#78d9ec` |
| orange | `#fcad70` |

- **Icons** (`probe/icons.js`): 16px grid, 1.5 stroke, round ends, `currentColor`; 12px (`.i.s`) inside text.
  `twisty`, `search`, `newFolder`, `log`, `settings`, `more`, `close`, `drag`, `rename`, `color`, `copy` (also
  duplicates), `delete`, `toFolder`, `closeTabs`, `back`, `done`, `warning`, `mr`, `pipeline`, `job`, `build`,
  `sound`, `workspace`, `noDrop`, `dropZone` (also Move to the top level), `emptyTree`, `pin`; and the filled
  `folder` glyph. No text glyphs are left in the UI except `›` between crumbs and key caps (`/`, `↵`, `Esc`).

## Parts and their states

**Header** (`.hdr`)
- Search field (`.search`): search icon, `#q` (placeholder `Search tabs, PROJ-123, mr, jira…`), then a `/` key cap,
  or, while it holds text, **✕** (`#q-clear`). Focused: accent border, raised ground and a `--sel` ring.
- Icon buttons (`.ib`, 26px): **New folder** (`#new-folder`), **Log** (`#open-log`), **Settings**
  (`#open-settings`).

**Pinned row** (`.pinned`): 32×26 tiles (`.pin`) on `--sunken` with the 16px favicon. The active one (`.pin.on`) is
filled with `--current` and underlined in the accent; a tab playing sound has an accent dot (`.snd`). Hidden without
pinned tabs, and outside the tree.

**Tab row** (`.row`, 24px, inset 4px, radius 6; `--d` = depth, indent `4 + 12 × depth`). Left to right:
- **Twisty**: a chevron, rotated down when open (`.twisty.open`), or an empty 12px slot.
- **Favicon** 16px; a missing or broken one becomes a letter chip (`.noicon`).
- **Key** (ticket roots only): `--accent-text`, semibold.
- **Title**: fills the space and gives way first, cut with an ellipsis. A ticket's page that only repeats the
  ticket's title reads as its kind in `--fg-2` (`.title.as-kind`: `MR !812`).
- **Kind** (`.kind`): the kind's icon and number, `!820 · changes`, `#5521`; its tooltip has the words.
- **Flags**: `draft` (outlined badge), `dup` (warning badge), the sound icon.
- **Count** (`.count`, a pill): `+N` on a folded row.
- **Actions** (`.acts`, 20px buttons, on hover or while the row's menu is open, `.menu-open`), in the count's
  place: **✕** (`Close tab`), **⋯** (`More actions`) and the drag handle; a top-level ticket shows **→ folder**
  (`Put PROJ-9 into a new folder`), **✕** and **⋯**.
- **Guides** (`::before`): a hairline under each ancestor's twisty.

States:
- **hover**: `--hover` fill; the twisty darkens;
- **active tab** (`.current`): `--current` fill, a 3×14 accent pip at the left edge, semibold title;
- **selected** (`.selected`): `--sel` fill; neighbouring selected rows join (no inner corners); selected and active
  show both;
- **discarded**: grey, faded favicon and a muted title;
- **dragging**: 40% opacity;
- **tooltip**: full title and URL (the browser's own).

**Folder row** (`.row.folder`, `data-folder`): twisty, the folder glyph in its color (`.dot`, a click switches to
the next color), the name in semibold, `N dups` (a warning badge button with a ✕ icon, when the folder holds
duplicates), the actions **+** (`New folder inside`), **⋯** and the drag handle on hover, and the count of all tabs
inside. **Renaming**: the name turns into a field (`input.rename`: accent border, `--sel` ring) followed by `↵` and
`Esc` key caps; the count and actions hide.

**Island** (a top-level folder with 2+ tabs while the mirror is on): every row of the island gets `.isl` and the
folder's `.c-<color>`; `::after` draws a 3px rail in the color at the left edge, starting under the folder's glyph
(`.head`) and ending at the island's last row (`.end`). The head's count is tinted with the color. A folded island
has no rail.

**Other workspaces**: a section label (`.section`, small caps with a line), then one row per workspace
(`.row.group`): twisty, the workspace icon, its name, the count. Folded by default; its tabs are plain rows one level
in.

**Drag and drop**
- **before / after**: a 2px accent line with a ring at its left end (`.dl`), at the depth the item will land;
- **inside**: `--sel` fill and a 1.5px accent outline (`.drop-inside`);
- **not allowed**: no marker; the pointer shows no-drop;
- **drop zone** (`.drop-zone`, below the list while dragging): a dashed box with the drop-zone icon and "Drop here:
  last on the top level"; solid accent and `--sel` while over it (`.drop`);
- **drag image** (`.ghost`): favicon or glyph, key and title in semibold on a raised card, tilted 2°, with an accent
  count pill when several rows go.

**Menu** (`.menu`, 228px, raised, radius 8; on ⋯ or right click; flips up near the bottom edge):
- Items (`.mi`, 26px): an icon (or an empty slot), the label, a shortcut on the right (`Middle click`), or a hint on
  a second line (`.mi.tall`: `This tab and everything under it`, `Its tabs move one level up`, `Loads again when
  opened`). Hover and keyboard focus: `--sel`. Dangerous items (**Delete folder**, the selection's **Close …**) are
  in `--danger`.
- Separators (`.msep`). The folder menu has a `Color` label and a row of nine round swatches; the current one is
  ringed.

**Setup guide** (`.card` at the top of the tree): title, subtitle, three steps with a number in a `--sel` circle,
or a tick in an accent circle when done; a bold name and a muted line each. Buttons **Got it** (primary) and
**Later**.

**Empty states** (`.empty`): a glyph in a rounded square, a title, a line of text and a button: `No tabs in this
workspace` with **New folder**; `No tabs match` with **Clear search** (and an `Esc` key cap).

**Selection bar** (`#selbar`, floating 8px above the status bar, raised, radius 8, 38px):
- `3 selected` (semibold), `4 tabs, 1 folder` (muted, cut first), **Folder**, **Close**, **✕**.
- **Armed** (`.armed`, `role="alertdialog"`): `--danger-bg` with a danger outline, the question
  `Close 4 tabs and 1 folder?` in semibold, **Close** (danger button) and **Cancel**, and a 3px danger strip along the
  bottom that runs down over 4 seconds (a CSS animation).
- At 300px and less, its buttons drop their icons.

**Status bar** (`.status`, 26px, 11px muted): the counts (cut with an ellipsis), then **Islands** with an 8px square
per island in its color (`#islands`); `Islands off` when the mirror is off; hidden when there are no islands.

**Messages** (`.toast` in `#toasts`, floating above the status bar, or above the selection bar while it shows):
a confirmation is inverted (`--fg` ground) with a tick; an error has `--danger-bg`, a danger outline, the warning
icon and **Copy report**.

**Search results**
- A line on top (`.meta`): `4 tabs` and `↑ ↓ move · ↵ open · Esc clear`.
- Two-line rows (`.row.hit`), flat: favicon; key, title with the matched words in `mark`, kind, flags, and the
  workspace's name as an outlined badge (`.badge.ws`) for another workspace; under it, muted and 11px, the path
  (`.crumbs`): a square in the top-level folder's color and `Release 2.4 › PROJ-101 › PROJ-140`, or `Top level`,
  the pin icon and `Pinned`, the workspace icon and `Workspace Personal · opens there`.
- The highlighted result has a 1.5px accent outline (`.row.hl`).

**Log view** (`.logv`, under the bar with **Copy report**):
- `This window`, then a grid (`.kv`): Opera, APIs (`✓`/`✗` in `--ok`/muted), Tabs, Workspaces, Folders, Placements,
  Snapshot, and Wallpaper when there is one; values in mono.
- A segmented switch (`.seg`) **Events** | **Background changes**, each with its count.
- Events, newest first (`.ev`): the time in mono, a tag tinted with its kind's color (created and link blue, place
  purple, folder yellow, mirror cyan, closed red, restored green, startup and background changes grey), the text
  with ids in mono.
- Copy by hand: a warning banner (`The clipboard refused. The report is selected: press Ctrl+C, then Esc.`) above
  the report in a text area, selected, on `--sel` with an accent outline.

**Settings view** (`.settings`, under the bar):
- Section labels (`.sub`): **Background**, **Tree**, **Opera**, **Diagnostics**, **Setup**.
- Options (`.opt`): a bold name (a label for switches), a muted description, and on the right a switch
  (`input.switch`, 30×18, accent when on) or a small button.
- **Never for**: chips (`.chip`) with the key and a ✕ button, inside the Auto-folders option.
- Islands: a bordered list (`.islands`, `.il`): color square, name, `9 tabs · island` (or why not).
- Background: see below.

## The wallpaper mode

A picture of the owner's behind the panel (`body.wp`), set in Settings › Background.

- **Layers:** `#wall` (`<img>`, first in `body`, `object-fit: cover`, `object-position: var(--x) 50%`), then
  `#scrim` over it, then everything else. `body` gets `isolation: isolate` and the scrim's color as its ground.
- **Scrim:** `rgb(var(--scrim) / var(--dim))`, a little stronger at the top (`--dim-top`, under the header). Its
  color is the picture's darkest tone made very dark in the dark theme, and the picture's average made near white in
  the light one. **Dim** sets its alpha (the light theme adds 8%).
- **Blur:** `filter: blur(var(--blur)) saturate(1.15)` and `scale(1.08)`, so the blurred edges stay outside.
- **Translucent tokens** in `body.wp`: `--hover`, `--current`, `--sunken`, `--raised`, `--chip`, `--line`, `--guide`
  become white or dark veils, and the text tokens shift to stay readable (dark: `--fg #f3f3f8`, `--muted #b0b3c6`;
  light: `--fg #1d1a26`, `--muted #5d5670`). Hover and selection tint the picture instead of hiding it. The search
  field, pinned tiles, the selection bar, menus, messages and the setup card are frosted (`backdrop-filter: blur(14px)
  saturate(1.3)`). In the dark theme, rows, the status bar and section labels get a soft text shadow. The status bar
  has a veil of its own instead of its top line.
- **Accent:** **Blue** keeps the theme's accent, with a translucent `--sel`. **From wallpaper** sets `--accent`,
  `--accent-fg`, `--accent-text`, `--sel` and `--sel-hover` from the picture's most frequent strong color
  (`wallTokens()` in wallpaper.js): with the owner's picture, about `#ee96cc` (dark) and `#b9418a` (light).
- **Settings › Background:** a segmented **None** | **Image file** (`#wp-none`, `#wp-file`); with a picture: a 96px
  thumbnail of the whole picture (`.slice`) with a white frame over the part behind the panel and the rest darkened
  (`#wp-frame`, drag it or use ← →); `Drag the frame to pick the part behind the panel.`; the file's name and stored
  size with **Change…** and **Remove**; sliders **Dim** (`#wp-dim`, `70%`) and **Blur** (`#wp-blur`, `0 px`) with
  their values; **Accent** as two pills (`.acc`), each with a swatch, the chosen one outlined in the accent.

## Widths

From 260 to 450px, with no horizontal scrolling (`.list` hides horizontal overflow). In a row the title gives way
first; key, kind, flags and the count stay whole. Crumbs cut each part. The header's search field shrinks; the
selection bar cuts its description first, and at 300px and less its buttons lose their icons.

## What is still weak

- **Hover-only actions** are invisible until hovered; the drag handle says a row can be dragged, but only on hover.
  A right click gives the same menu as ⋯.
- **No keyboard navigation of the tree** (arrows, Enter on rows); only search, menus and Settings work from the
  keyboard.
- **The drag image** is drawn off screen for `setDragImage`; whether Opera keeps its 2° tilt and shadow is not
  checked.
- **The wallpaper's thumbnail** crops pictures wider than about 4:1, and then the frame shows the place only roughly.
- **A very thin scrim** over a mid-tone picture can leave text below 4.5:1; Dim is the owner's choice.

## What any change has to keep

- **Every interaction in FEATURES.md:**
  - click, middle click, Ctrl/Shift/Ctrl+Shift click, click on empty space;
  - drag with before/inside/after zones and a way to drop at the end of the top level;
  - folder create, rename in place, color and delete; `→ folder`;
  - ✕ and ⋯ on rows, right click, and every menu item in FEATURES.md › Menus;
  - the setup guide, Settings (switches, Never for, island states, the background), search paths and marks;
  - `/`, arrows, Enter, Esc, Delete;
  - the Log view and Copy report (they are how bugs get diagnosed).
- **Density:** 24px rows and up to 6 indent levels at 260px width, with no horizontal scrolling. Titles are cut with
  an ellipsis, and the full title and URL are reachable (tooltip).
- **Both themes**, with and without a wallpaper.
- **The nine folder colors**, because they map to Opera's island colors.

## Building it

- **Tech:**
  - plain HTML, CSS and JS in `probe/`, loaded as they are: no build step, no framework. Adding either is a
    decision for the owner;
  - Manifest V3 rules apply: no inline `<script>`, no `eval`, no scripts from other sites;
  - inline `style` attributes, CSS and local or data-URL images are fine; favicons are remote images;
  - fonts and icons are bundled in `probe/` (icons.js) or are system fonts.
- **Where things are:**
  - markup skeleton: `probe/panel.html` (header, the Log/Settings bar, selection bar, status bar, the wallpaper's
    layers, the file input);
  - styles: `probe/panel.css`; icons: `probe/icons.js`; wallpaper colors: `probe/wallpaper.js`;
  - rows are built in `probe/panel.js`: `tabRow()`, `renderNode()`, `renderFolder()`, `renderGroup()`, `placeRow()`,
    `kindTag()`, `renderSearch()`, `hitRow()`, `crumbs()`, `renderPinned()`, `renderSelBar()`, `renderStats()`;
  - menus in `openMenu()`, `menuItem()`, `swatches()`, `moreButton()`, and their contents in `folderMenu()`,
    `tabMenu()`, `selectionMenu()`; the guide in `guideCard()`, empty states in `emptyState()`, Settings in
    `renderSettings()` and `backgroundSettings()`, the Log view in `renderLog()`, messages in `toast()`, the
    wallpaper in `applyWallpaper()`;
  - the whole list is rebuilt on every change (`render()`, `redraw()`).
- **Hooks the tests use** (`tests/helpers/panel-env.js`, `tests/panel-*.test.js`):
  - elements: `#list`, `#list .row`, `.row .title`, `.row.selected`, `.folder .dot`, `#new-folder`, `#open-log`,
    `#open-settings`, `#back`, `#hdr`, `#vbar`, `#view-title`, `#report`, `body[data-view]`, `#q`, `#q-clear`,
    `.search .k`, `#stats`, `#islands .sq`, `#pinned .pin`, `.pin.on`, `.snd`, `input.rename`, `.drop-zone`,
    `.dl.before`, `.drop-before|after|inside`, `#toasts .toast`, `.toast.err`, `.toast .grow`;
  - rows: `--d`, `.isl`, `.head`, `.end`, `.c-<color>`, `.kind` (text, title, icon), `.title.as-kind`, `.count`,
    `.menu-open`, `.acts .grip`, `data-folder`, `data-ref`, `.section`, `.row.group .title`, `.row.group .count`;
  - row buttons by `aria-label`: `Close tab`, `More actions` (and its `aria-expanded`), `Put PROJ-9 into a new
    folder`, `New folder inside`, `Close 1 duplicate`; and their `title`s;
  - the selection bar: `#selbar` (`.armed`, `role`), `#sel-count`, `#sel-what`, `#sel-folder`, `#sel-close`,
    `#sel-cancel`, `#sel-clear`, `#selbar .timer`;
  - menus: `.menu` (with `hidden`), `.mi .label`, `.mi .hint`, `.mi.danger`, `.msep`, `.sw[data-color]`, `.sw.on`;
  - the drag image: what `setDragImage` gets (`.ghost`);
  - the guide: `.card`, `.card h4`, `.card button` by text (`Got it`, `Later`), `.steps li[data-step]`, `.steps .num`
    (a tick icon when done), `.steps li.done`, `.steps li b`;
  - empty states: `#list .empty h4`, `.empty p`, `.empty button` by text;
  - Settings: `.settings .sub`, `.opt b`, `.opt button`, `#set-auto-folders`, `#set-mirror`, `.chip[data-key] button`,
    `.chips .muted`, `.islands .il .grow`, `.il .m`;
  - the Log view: `.logv .kv dt`, `.ev .t` (and its `c-<color>`), `.ev p`, `.seg button`, `.seg button.on`,
    `.banner`, `textarea.report`;
  - search: `.row.hit`, `.hit .key`, `.hit .kind`, `.meta span`, `.crumbs`, `.crumbs .sq`, `mark`, `.badge.ws`,
    `.row.hl`;
  - the wallpaper: `body.wp`, `#wall` (`src`, `--x`, `--blur`, `.blur`), `#scrim` (`--dim`), `body`'s `--accent`,
    `--sel`, `--scrim`, `#wp-none`, `#wp-file` (`aria-checked`), `#wp-dim`, `#wp-blur`, `#wp-frame`
    (`aria-valuenow`), `.slice`, `.wp-name span`, `.wp-name button` by text, `.acc[data-accent]`, `.acc.on`,
    `#wp-input`;
  - rows found by their visible text.

  Keep them, or update the tests along with the change.

## Where the build differs from the canvas

- **Tooltips** are the browser's own `title` tooltips; the canvas's custom title-and-URL card is not built.
- **Density** is 24px rows only; the canvas's compact (22) and roomy (26) variants are not offered.
- **Swatches** in the folder menu are 4px apart instead of 5, so that nine fit in the 228px menu.
- **Page kinds** show on every tab of a merge request, pipeline, job or build, as on the canvas's `nightly-build`;
  before, only a ticket's rows had them.
- **States the canvas doesn't draw:** `Islands off` in the status bar (hidden when there are no islands), a folded
  island without a rail, the success message (a tick, inverted), a click on a message dismissing it, and the
  `Pinned` path with the pin icon.
- **Log view:** a `Wallpaper` line joins the summary when there is one; background changes get grey `title` and
  `favicon` tags. The copy-by-hand box is a text area styled like the canvas's selected report, so that Ctrl+C
  works on it.
- **Settings › Background:** only **None** and **Image file** (Opera's wallpaper and the Opera theme accent are left
  out until the native helper exists). The file's name with **Change…** and **Remove** sits under the thumbnail, and
  None shows a line of help.
- **The selection bar** drops its button icons at 300px and less, so that ✕ stays on screen.
- **Menu items** without a fitting icon among the 27 (Reload, Unload) keep an empty icon slot; **Move to the top
  level** uses the drop-zone icon.

## Sample content for mockups

Realistic but made up; don't use real work data.

- **Pinned:** Team chat, Mail, Music.
- **Folder "Release 2.4"** (blue, mirrored as an island):
  - Folder "Dashboards" (pink): Checkout latency (Grafana), Error budget (Grafana).
  - PROJ-101 "Payments initiative" (Jira):
    - PROJ-140 "Retry policy epic" (Jira):
      - `MR !812` (GitLab, repeats the title);
      - "Backoff tuning" `MR !820` `draft`;
      - "Backoff tuning" `MR !820 · changes` `dup`;
      - PROJ-151 "Jitter for retries" (Jira), with `pipeline #5521`.
- **Folder "Infra"** (green, island): `nightly-build` `build #128` (Jenkins), "Node exporter" (Grafana).
- **Folder "Personal"** (grey, one tab, so no island): Online bank.
- **Top level:**
  - "Merge requests" (GitLab list) → PROJ-160 "Rate limiter" `MR !830`;
  - "Inbox – Mail";
  - "Assistant chat".
- **Workspace "Personal"** (folded): 2 tabs.
