# Branchy: what goes into the store listings

Texts to paste into the Chrome Web Store, Microsoft Edge Add-ons and Opera add-ons, and the answers to their privacy
forms. The name, summary, version and icon come from the manifest (`probe/manifest.json`); images are in
`store/images/`. Keep this true when the extension changes.

## Basics

| Field | Value |
|---|---|
| Name | Branchy (from the manifest) |
| Summary | from the manifest's `description` (124 of 132 characters): *Tree style tabs in the sidebar: a tab hangs under the one that opened it, tickets gather their merge requests, folders nest.* |
| Category | Chrome: Productivity › Tools. Edge: Productivity. Opera: Productivity |
| Language | English |
| Homepage / support | https://github.com/ReQur/TabTree (support: its Issues) |
| Privacy policy | https://github.com/ReQur/TabTree/blob/main/PRIVACY.md |
| Screenshots | `store/images/1-tree.png` … `5-wallpaper.png` (1280×800), in that order |
| Small promo tile (Chrome) | `store/images/promo-440x280.png` |
| Store logo (Edge) | `store/images/logo-300.png` |
| Search terms (Edge, up to 7) | tree style tabs · vertical tabs · tab manager · tab groups · side panel · tickets · merge requests |

## Description

```
Branchy shows your tabs as a tree in the browser's side panel, the way an IDE shows files.

• A tab hangs under the tab that opened it. Close a tab and the tabs under it move up a level.
• Tickets gather their pages. Tabs that carry a tracker key such as PROJ-123 (the issue, its merge requests, pipelines and builds) hang under the ticket, wherever they were opened from. Tickets opened from tickets nest: initiative → epic → task → merge request reads as one branch.
• Folders nest, with names and colors. Top-level folders are mirrored as the browser's tab groups (islands in Opera), so the tab strip shows the same grouping. A ticket on the top level gets a folder of its own once it has a second tab.
• Statuses at a glance, if you want them: connect a Jira, GitLab or Jenkins site in Settings, and each row shows where its work stands: a ticket's status, what keeps a merge request from merging, a pipeline's progress, a failed job, a build's time left. They are read with your own sign-in in the browser; no tokens.
• Drag and drop, multi-select, menus on right click: move, close, reload or unload a whole branch, or copy its links as Markdown.
• Search by title, ticket, page kind or status; each result shows where its tab sits in the tree.
• A link opened from another app goes to the tab that already shows that page, instead of opening a copy.
• The tree survives browser restarts.
• Light and dark themes, text size, and a picture of yours behind the tree, with the accent taken from it.
• Backup: export the tree to a file, and import it in another browser or profile.

Privacy: everything stays in your browser. Branchy has no server, collects no analytics and sends nothing to anyone. Statuses are read only from the sites you connect. Privacy policy: https://github.com/ReQur/TabTree/blob/main/PRIVACY.md

Works in Chrome, Edge and Opera. Source code: https://github.com/ReQur/TabTree
```

## Chrome Web Store: Privacy practices

**Single purpose**

```
Branchy shows the browser's tabs as a tree in the side panel and keeps them organized: tabs under the tabs that opened them, tickets with their pages, folders mirrored as tab groups, and, for sites the user connects, the statuses of the tickets, merge requests, pipelines and builds those tabs show.
```

**Permission justifications**

| Permission | Justification |
|---|---|
| `tabs` | Reads the titles and URLs of open tabs to build the tree and find ticket keys; opens, closes, reloads and unloads tabs when the user asks; shows a link opened from another app in the tab that already has that page. |
| `tabGroups` | Mirrors the user's top-level folders as tab groups, with the folder's name and color. |
| `webNavigation` | Tells a page opened from another app (its first navigation is marked as a start page) from a link opened inside the browser, and finds the source tab of links that open without an opener. |
| `storage` | Keeps the tree, folders, settings, statuses and the snapshot that restores the tree after a restart, in the browser. |
| `alarms` | Wakes the extension every 30 seconds, only while a site is connected, to check the statuses of the open tabs' pages. |
| `clipboardWrite` | Copies links, Markdown lists of links and the diagnostics report when the user clicks Copy. |
| `sidePanel` | Shows the tree in the side panel, opened from the toolbar button. |
| Host permissions (optional, `https://*/*`, `http://*/*`) | Nothing is granted at install. When the user clicks Connect for a Jira, GitLab or Jenkins site in Settings › Statuses, the browser asks for that one site; Branchy then reads its API with the user's session, only to show statuses. The user can disconnect it at any time. |

**Remote code:** No, I am not using remote code. (Everything runs from the package; no scripts from other sites, no `eval`.)

**Data usage.** Branchy keeps everything on the device and sends nothing to its developer or to third parties. The
safe way to fill the form is to declare what it handles:

- **Web history**: the titles and URLs of open tabs, and a snapshot of them for restarts.
- **Website content**: the statuses read from the sites the user connects.

and to tick all three certifications: data isn't sold or transferred to third parties outside the approved use cases;
it isn't used or transferred for purposes unrelated to the item's single purpose; it isn't used or transferred to
determine creditworthiness or for lending.

## Microsoft Edge Add-ons and Opera add-ons

The same description, privacy policy and images. Edge also asks for the store logo (300×300) and search terms (above),
and, per permission, the same justifications as Chrome. Opera asks for screenshots and reviews the package by hand;
if it wants another screenshot size, `store/screens/compose.js` is where the 1280×800 canvas is laid out.
