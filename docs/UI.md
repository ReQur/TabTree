# TabTree: the panel's UI

The UI as it is now, what it has to support, and what could be better. Written as a brief for redesigning it, and
as a map for implementing a new design. The menus, Settings, the setup guide and the search results' second line
already work, taken from the design canvas, but carry only minimal styling until the design is implemented. What each control does is in [FEATURES.md](FEATURES.md); where the code is,
in [ARCHITECTURE.md](ARCHITECTURE.md).

## Where the panel lives

- **Place:** a page inside Opera's sidebar on the left. Left to right: Opera's sidebar icons (~40px), **the panel**,
  Opera's collapsed native tab strip (~35px favicon column), then the web page.
- **Size:** the user sets the width by dragging its edge. Expect 260–450px (the owner's is ~380px). It takes the
  full window height.
- **Opera's title bar:** Opera draws its own bar above the panel with the extension's name (`name` in
  `manifest.json`, now "TabTrees Probe"), a reload button and a pin. It isn't ours to style. The icon in Opera's
  sidebar comes from `probe/icons/`.
- **Theme:** light or dark, following `prefers-color-scheme` (the owner uses Opera's dark theme). Both must work.
- **Font:** the system UI font (Segoe UI on Windows), 12px.
- **Amount:** usually 10–100 tabs, 3–10 folders and trees up to 5–6 levels deep. Titles are long. Density matters:
  the panel competes with the page for width.

## Layout now

```
┌──────────────────────────────────────────────────┐
│ [ Search: words, ticket number, mr, jira…  ( / ) ] │  header
│ [  Tree  ][  Log  ][ Settings ]        [ + Folder ]│
├──────────────────────────────────────────────────┤
│ (chat) (mail) (music)                             │  pinned tabs: favicon buttons
├──────────────────────────────────────────────────┤
│ ┌ Set up TabTree ─────────────────────────────┐   │  setup guide, until dismissed
│ │ ✓ Pin this panel                            │   │
│ │ 2 Collapse Opera's tabs                     │   │
│ │ 3 Turn off automatic Tab Islands            │   │
│ │ [Got it] [Later]                            │   │
│ └─────────────────────────────────────────────┘   │
│ ▾ ■ Release 2.4                         + ⋯    7  │  folder: color square, hover buttons, tab count
│   ▾ ■ Dashboards                               2  │  nested folder
│        (G) Checkout latency                       │
│        (G) Error budget                           │
│   ▾ (J) PROJ-101  Payments initiative             │  ticket root: key + cleaned title
│     ▾ (J) PROJ-140  Retry policy epic             │  sub-ticket
│          (F) MR !812                              │  a ticket page that only repeats the title
│          (F) Backoff tuning  [MR !820] [draft] [dup] │
│ ▾ (F) Merge requests                              │  hub page, not a ticket
│     (F) PROJ-160  Rate limiter  [MR !830] [→ folder] ✕ ⋯ │  hover buttons
│   (M) Inbox – Mail                                │
│ ▸ Workspace: Personal                          2  │  other workspaces, folded
│                                                   │
│   ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐    │  drop zone, only while dragging
│     Drop here: last on the top level              │
│   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘    │
├──────────────────────────────────────────────────┤
│ 3 selected: 5 tabs, 1 folder  [→ Folder][Close][✕] │  selection bar, only while selecting
├──────────────────────────────────────────────────┤
│ 32 tabs · 5 folders · 12 tickets        [Copy report] │  footer
└──────────────────────────────────────────────────┘
```

(G), (J), (F), (M) stand for favicons.

## Parts and their states

**Header**
- Search field. Placeholder `Search: words, ticket number, mr, jira…  ( / )`; accent border on focus.
- View switch **Tree | Log | Settings**: three equal buttons; the current one is filled.
- **+ Folder**: a text button.

**Pinned row**
- One 26×24 button per pinned tab, with a 16px favicon. The active tab's button is filled. Hidden when there are no
  pinned tabs.

**Tab row** (22px tall; indent 4px + 14px per level). Left to right:
- **Twisty** `▾` / `▸`, or an empty 10px slot.
- **Favicon** 16px. A missing or broken one becomes a 16px chip with the host's first letter.
- **Key** (ticket roots only): accent color, semibold.
- **Title**: fills the space, cut with an ellipsis.
- **Badges**, small chips:
  - page kind (`MR !820`, `MR !820 · changes`, `pipeline #5521`, `job #31`, `build #128`);
  - `draft`;
  - `dup`, in warning color;
  - `♪`.
- **`+N`** when the row is folded (tabs under it).
- Hover-only buttons: **`→ folder`** on top-level ticket roots, then **✕** (title "Close tab (middle click)") and
  **⋯** (title "More actions (right click)") on every tab row of the tree.

States:
- **hover**: tinted background;
- **active tab**: accent-tinted background;
- **selected**: stronger tint plus a 2px accent bar on the left;
- **discarded** (unloaded by Opera): dimmed title;
- **dragging**: 45% opacity;
- **drop before / after**: a 2px accent line on the top or bottom edge;
- **drop inside**: dashed accent outline;
- **search highlight**: 1px accent outline;
- **tooltip**: full title and URL.

Middle click closes the tab; right click opens the tab's menu.

**Ticket page row** (a tab under its ticket): the same as a tab row. When its title only repeats the ticket's, the
title reads as the page kind (`MR !812`). Otherwise it shows its own title plus a kind badge.

**Folder row**
- 22px tall, semibold.
- **Twisty** (empty for an empty folder).
- **Color square** 10×10, rounded 3px, one of 9 colors. Clicking it switches to the next color.
- **Name**, then `✕ N dups` when the folder holds duplicates.
- Hover-only buttons **+** (new folder inside) and **⋯** (the folder's menu, with Rename and Delete). There is no ✕
  on a folder row, so ✕ on a row always means "close this tab".
- **Count** of all tabs inside.

States: hover, selected, folded, dragging, drop markers. **Renaming**: the name turns into a text field (accent
border) in place.

**Workspace group row**
- Semibold `Workspace: <name>` with a count; folded by default.
- Its tabs are a flat list of tab rows that can't be dragged.

**Drop zone**
- A dashed box with the text "Drop here: last on the top level", shown below the list while dragging. It is
  highlighted when something is over it.

**Menu** (`.menu`, on ⋯ or right click; one at a time, fixed position, flips up near the bottom edge):
- Items: a label and an optional hint on a second line (`Middle click`, `This tab and everything under it`,
  `Its tabs move one level up`, `Loads again when opened`). Dangerous items (**Delete folder**, the selection's
  **Close …**) are in the danger color.
- Separators between groups.
- The folder menu has a row of nine color squares; the current color is outlined.
- Keyboard focus starts on the first item; ↑ ↓ move, Enter uses, Esc closes.
- The contents of each menu are in FEATURES.md › Menus.

**Setup guide** (`.card` at the top of the tree):
- Title "Set up TabTree", subtitle, three numbered steps with a bold name and a muted line each. A ticked step shows
  ✓ in an accent circle instead of its number. Steps are clickable.
- Buttons **Got it** (primary) and **Later**.

**Settings view** (replaces the list; `.settings`):
- Section headings **Tree**, **Opera**, **Diagnostics**, **Setup** (small caps, muted).
- Options: a bold name, a muted description, and a control on the right: a checkbox switch or a small button.
- **Never for**: chips with the ticket key and ✕; "No ticket is kept out of automatic folders." when empty.
- Islands: one line per top-level folder: color square, name, `N tabs · island` (or why not).

**Selection bar**, only while something is selected:
- The count text: `N selected: 5 tabs, 1 folder`.
- Buttons **→ Folder**, **Close**, **✕**.
- Close has an armed state: warning background, reading `Sure? Close 5 tabs, 1 folder`, for 4 seconds.

**Footer**
- Counters (cut with an ellipsis) and **Copy report**.
- Short messages temporarily replace the counters for 2.5 s: `Report copied`, `Link copied`, `Links copied`,
  `place failed: …`.

**Search results**
- A muted line on top: `4 tabs · ↑ ↓ move · Enter opens · Esc clears`.
- Two-line rows (`.row.hit`), flat, no indent: favicon; key, title with the matched words in `<mark>`, badges; under
  it, muted and smaller, the path (`.crumbs`): the top-level folder's color square and
  `Release 2.4 › PROJ-101 › PROJ-140`, or `Top level`, `Pinned`, `Workspace Personal · opens there`.
- The highlighted result has an outline.
- A tab from another workspace carries the workspace name as a badge.
- With nothing found: a line saying what is searched ("No tabs match. Every word has to match…").

**Log view**
- A monospace (11px) pre-formatted report that fills the list area.
- If copying to the clipboard fails, a textarea with the report replaces the list until Esc.

## Tokens now (`probe/panel.css`)

| token | light | dark | used for |
|---|---|---|---|
| `--bg` | `#ffffff` | `#1e1f24` | page |
| `--fg` | `#1f2328` | `#e3e5e8` | text |
| `--muted` | `#6e7781` | `#8b9098` | secondary text, twisties, counts |
| `--hover` | `#f0f2f5` | `#2a2c33` | row hover, inputs, selection bar |
| `--active` | `#dbe9ff` | `#243553` | active tab, current view, button hover |
| `--selected` | `#c9dcff` | `#34507e` | selected rows |
| `--border` | `#d0d7de` | `#34363d` | separators, drop zone |
| `--accent` | `#2f6feb` | `#6ea8ff` | keys, focus, drop markers, selection bar edge |
| `--chip` | `#eef1f4` | `#2d3038` | badges, buttons |
| `--warn` | `#d29922` | (same) | `dup`, armed Close |
| `--danger` | `#cf222e` | `#ff7b72` | dangerous menu items |
| `--mark` | `#fff2a8` | `#5a4a12` | matched words in search results |

- **Type:** 12px/1.35 system UI; badges 10px; log 11px monospace. Semibold for folders, groups and keys.
- **Radii:** 3–4px.
- **Spacing:** 6px gaps inside rows; header, footer and bars have 4–6px padding.
- **Folder and island colors**: Opera allows these nine only. The hex values below are for our squares; the
  islands in Opera's strip use Opera's own shades.

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

- **Icons:** there is no icon set, only Unicode glyphs `▾ ▸ + ⋯ ✕ → ♪ ✓` and letter chips.

## What is weak today

- **Icons** are text glyphs with uneven weight and size.
- **Hover-only actions** (+ ⋯ ✕, → folder) are invisible until hovered, and nothing says "you can drag this". The
  menus work, but look plain.
- **Active and selected** are two similar blues. A selected active tab is hard to read.
- **Islands are invisible in the panel:**
  - nothing shows that a top-level folder is mirrored as an island (it needs 2+ tabs), or which color Opera uses
    for it;
  - nothing tells folders apart from ticket rows at a glance except the square.
- **Ticket rows** fight for width: key, long title, kind badge, draft, dup. The key chip and kind badges have no
  hierarchy between them.
- **Deep trees** (5–6 levels) have no indentation guides and get hard to follow.
- **Two kinds of counts** look different: a folder's total and a folded tab's `+N`.
- **The header** spends a whole row on two view buttons and a text button.
- **The footer** is crowded (counters, two switches, a button). The switches are settings and could live elsewhere.
  Error messages flash in the counters' spot.
- **The selection bar and armed Close** are plain; the confirm is only a color change and a text change.
- **Drop markers** are a thin line or a dashed outline, which is hard to see on a moving target.
- **Missing views:**
  - the pinned row is bare icons;
  - the workspace group is plain text;
  - there is no empty state (no tabs, no search results beyond a line of text);
  - the setup guide and Settings have only minimal styling;
  - the Log view is raw text.
- **Search results** have their matches marked and their path, with minimal styling.

## What any design has to keep

- **Every interaction in FEATURES.md:**
  - click, middle click, Ctrl/Shift/Ctrl+Shift click, click on empty space;
  - drag with before/inside/after zones and a way to drop at the end of the top level;
  - folder create, rename in place, color and delete; `→ folder`;
  - ✕ and ⋯ on rows, right click, and every menu item in FEATURES.md › Menus;
  - the setup guide, Settings (switches, Never for, island states), search paths and marks;
  - `/`, arrows, Enter, Esc, Delete;
  - the Log view and Copy report (they can move, but they are how bugs get diagnosed).
- **Density:** compact rows (about 22–26px) and up to 6 indent levels at 260px width, with no horizontal scrolling.
  Titles are cut with an ellipsis, and the full title and URL are reachable (tooltip).
- **Both themes.**
- **The nine folder colors**, because they map to Opera's island colors.

## Building it

- **Tech:**
  - plain HTML, CSS and JS in `probe/`, loaded as they are: no build step, no framework. Adding either is a
    decision for the owner;
  - Manifest V3 rules apply: no inline `<script>`, no `eval`, no scripts from other sites;
  - inline `style` attributes, CSS and local or data-URL images are fine; favicons are remote images;
  - fonts and icons must be bundled in `probe/` (for example, SVGs) or be system fonts.
- **Where things are:**
  - markup skeleton: `probe/panel.html`;
  - styles: `probe/panel.css`;
  - rows are built in `probe/panel.js`: `tabRow()`, `renderNode()`, `renderFolder()`, `renderGroup()`,
    `renderSearch()`, `hitRow()`, `renderPinned()`, `renderSelBar()`, `renderStats()`;
  - menus in `openMenu()`, `menuItem()`, `swatches()`, `moreButton()`, and their contents in `folderMenu()`,
    `tabMenu()`, `selectionMenu()`; the guide in `guideCard()`, Settings in `renderSettings()`;
  - the whole list is rebuilt on every change (`render()`).
- **Hooks the tests use** (`tests/helpers/panel-env.js`, `tests/panel-*.test.js`):
  - elements: `#list`, `#list .row`, `.row .title`, `.row.selected`, `.folder .dot`, `#new-folder`, `#selbar`,
    `#sel-count`, `#sel-folder`, `#sel-close`, `#sel-clear`, `input.rename`, `.drop-zone`, `#stats`, `#q`;
  - the view buttons `#views button[data-view]` and their `.on` state;
  - folder rows' `data-folder`;
  - row buttons by text: `→ folder`, `✕`, `⋯`, `+`, `✕ N dups`, and the titles of `✕` and `⋯`;
  - menus: `.menu` (with `hidden`), `.mi .label`, `.mi .hint`, `.mi.danger`, `.msep`, `.sw[data-color]`, `.sw.on`;
  - the guide: `.card`, `.card h4`, `.card button` by text (`Got it`, `Later`), `.steps li[data-step]`, `.steps .num`,
    `.steps li.done`, `.steps li b`;
  - Settings: `.settings h3`, `.opt b`, `.opt button`, `#set-auto-folders`, `#set-mirror`, `.chip[data-key] button`,
    `.chips .muted`, `.islands li .title`, `.islands li .count`, `pre.log`;
  - search: `.row.hit`, `.hit .key`, `.meta`, `.crumbs`, `.crumbs .dot`, `mark`, `.badge`, `#list .note`;
  - rows found by their visible text.

  Keep them, or update the tests along with the design.

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
- **States worth showing:**
  - one active tab;
  - three selected rows with the selection bar;
  - one row mid-drag with a drop marker;
  - one folder being renamed;
  - one discarded tab;
  - a folded branch showing `+3`.

## What the design session should hand over

- **Basics:** tokens for light and dark, type scale, spacing, the icon set.
- **Rows:** tab, ticket root, ticket page, folder and workspace group, with every state above.
- **Everything around them:**
  - header, pinned row, selection bar (including armed Close), footer or wherever the settings and report go;
  - drop markers and the drop zone, rename in place, search results, empty states, the Log/report view.
- **Widths:** ~280px and ~420px.
- **Format:** a static HTML/CSS mock, or a spec precise enough to map onto `panel.css` and the row builders in
  `panel.js`.
