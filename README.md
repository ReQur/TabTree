# Branchy

An extension for Opera, Chrome and Edge that shows your tabs as a tree in the sidebar, the way an IDE shows files,
instead of a flat tab strip. (Its first name was TabTree, which the repository keeps.)

## What it does

- **Tree of tabs.** A tab opened from a page (middle click, a link that opens a new tab) hangs under that page.
- **Tickets.** Tabs that carry the same tracker key (`PROJ-123` in the title or URL path) gather under the ticket's
  issue page: its merge requests, pipelines and so on. A ticket opened from another ticket becomes its child, so an
  initiative → epic → task → MR chain reads as one branch. Rows show the page kind (`MR !42`, `pipeline #7`) instead of
  repeating the ticket's title.
- **Folders** that nest, with a name and a color. Top-level folders with two or more tabs are mirrored as Opera Tab
  Islands (tab groups in Chrome and Edge), so the native tab strip shows the same grouping.
- **Automatic folders.** A ticket family on the top level gets its own folder once it has a second tab. Delete that
  folder (or drag the family out of it) and it won't come back.
- **Drag and drop:** the upper or lower edge of a row puts the item before or after it, the middle puts it inside.
- **Multi-select** with Ctrl+click and Shift+click; move the selection, put it into a new folder, or close it.
- **Menus** on ⋯ and right click: close, reload or unload a whole branch, put it into a folder, copy its links as
  Markdown, recolor or delete a folder.
- **Search** by words, ticket number or page kind (`/` to focus); each result shows where its tab sits in the tree.
- **Duplicates** of an already open URL are marked and can be closed in one click.
- **Light and dark**, following Opera, and optionally a picture of yours behind the tree, dimmed and blurred to
  taste, with the accent color taken from it.
- **Survives restarts:** the tree is saved as it changes and matched back to the restored tabs by URL.
- **Backup:** export the folders and tree to a file, and import it in another browser or profile.

The full list is in [docs/FEATURES.md](docs/FEATURES.md).

## Install

Opera:

1. Open `opera://extensions`, turn on developer mode, click **Load unpacked** and pick the `probe/` folder.
2. Open the panel from Opera's sidebar and pin it.
3. Recommended: turn on vertical tabs (Settings → Browser → Tabs) and keep them collapsed, and turn off Opera's
   automatic Tab Islands so they don't compete with the extension's folders.

Chrome and Edge: run `npm run pack`, then load `dist/chrome/` or `dist/edge/` unpacked from `chrome://extensions` or
`edge://extensions`, and pin Branchy to the toolbar: its button opens the side panel. In Chrome, Settings ›
Appearance › Side panel › Show on left puts the panel on the left.

A setup guide above the tree lists these steps until you dismiss it. **Settings** holds the switches and the
tickets kept out of automatic folders. The **Log** view and **Copy report** show what the extension sees and does,
for troubleshooting.

## Privacy

Everything stays in your browser: no server, no analytics. Statuses are read only from the sites you connect.
The full policy is in [PRIVACY.md](PRIVACY.md).

## Development

No build step: `probe/` is loaded as it is. The tests run in Node against fakes of the browser's APIs:

```
npm install
npm test
```

`npm run pack` writes `dist/<browser>/` and `dist/branchy-<browser>-<version>.zip` for Opera, Chrome and Edge: the
same files, each with its browser's manifest.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it works, stored data, the Opera facts it relies on.
- [docs/UI.md](docs/UI.md): the panel's UI, its states, and what a redesign has to keep.
- [CLAUDE.md](CLAUDE.md): notes for AI coding sessions.
