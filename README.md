# TabTree

An Opera extension that shows your tabs as a tree in the sidebar, the way an IDE shows files, instead of a flat tab strip.

## What it does

- **Tree of tabs.** A tab opened from a page (middle click, a link that opens a new tab) hangs under that page.
- **Tickets.** Tabs that carry the same tracker key (`PROJ-123` in the title or URL path) gather under the ticket's
  issue page: its merge requests, pipelines and so on. A ticket opened from another ticket becomes its child, so an
  initiative → epic → task → MR chain reads as one branch. Rows show the page kind (`MR !42`, `pipeline #7`) instead of
  repeating the ticket's title.
- **Folders** that nest, with a name and a color. Top-level folders with two or more tabs are mirrored as Opera Tab
  Islands, so the native tab strip shows the same grouping.
- **Automatic folders.** A ticket family on the top level gets its own folder once it has a second tab. Delete that
  folder (or drag the family out of it) and it won't come back.
- **Drag and drop:** the upper or lower edge of a row puts the item before or after it, the middle puts it inside.
- **Multi-select** with Ctrl+click and Shift+click; move the selection, put it into a new folder, or close it.
- **Search** by words, ticket number or page kind (`/` to focus).
- **Duplicates** of an already open URL are marked and can be closed in one click.
- **Survives restarts:** the tree is saved as it changes and matched back to the restored tabs by URL.

## Install

1. Open `opera://extensions`, turn on developer mode, click **Load unpacked** and pick the `probe/` folder.
2. Open the panel from Opera's sidebar and pin it.
3. Recommended: turn on vertical tabs (Settings → Browser → Tabs) and keep them collapsed, and turn off Opera's
   automatic Tab Islands so they don't compete with the extension's folders.

The **Log** view and **Copy report** button show what the extension sees and does, for troubleshooting.
