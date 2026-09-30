# Branchy privacy policy

Effective September 30, 2026.

Branchy is a browser extension for Chrome, Edge and Opera that shows your tabs as a tree in the browser's side panel.
This policy says what it reads, what it keeps, and where anything goes. In short: **everything stays in your
browser. Branchy has no server, collects no analytics, and sends nothing to its developer or to anyone else.**

## What Branchy reads

- **Your tabs:** their titles, addresses, icons, and which tab opened which. This is what the tree is made of.
  Private (incognito) tabs are left out.
- **Tab groups** (islands in Opera): Branchy creates, names and colors them to match your top-level folders.
- **New tabs' first navigation:** to tell a link opened from another app from a link opened inside the browser, so
  that a page that is already open is shown in its tab instead of opening a copy.
- **Sites you connect, and only those:** if you choose to see statuses of tickets, merge requests, pipelines and
  builds, Branchy reads them from the Jira, GitLab or Jenkins site you connect in Settings › Statuses. The browser asks
  for your permission for each site. Branchy then reads those sites' APIs with the browser's own sign-in: it stores
  no passwords or tokens, it only reads, and it never changes anything there. You can disconnect a site at any time,
  and the switch **Show statuses** turns this off.

## What Branchy keeps, and where

Everything is kept in the extension's storage in your browser profile, on your computer:

- the tree: your folders, where each tab sits, and the order you set;
- a snapshot of the open tabs' addresses and titles, so that the tree comes back after the browser restarts;
- your settings, the tickets you told Branchy not to put into folders, and the background picture if you chose one;
- the statuses read from the sites you connected, for the pages of your open tabs only (statuses of closed tabs are
  dropped), and the answers of the connection Test;
- a short log of recent events (the last 200 tab events and 100 title changes: tab numbers, site names and folder
  names), shown in the Log view to help find problems.

This data is removed when you uninstall Branchy.

## Where anything goes

- **Nowhere by itself.** Branchy has no server and makes no requests to its developer or to third parties.
- **The sites you connect** receive Branchy's read requests, made with your browser's session, as when you visit them.
- **Tab icons** are shown from the addresses the browser gives for them, so the browser may load an icon from the
  tab's site.
- **Only when you ask:** **Export** saves a backup file of your folders, tabs' addresses and titles, settings and
  background picture where you choose; **Copy link**, **Copy links as Markdown** and **Copy report** put text on your
  clipboard. What you do with those is up to you.

Branchy does not sell or share data, does not use it for advertising or for anything other than showing your tabs,
and does not run code from anywhere else: everything it runs is in the extension. Its use of data complies with the
Chrome Web Store User Data Policy, including the Limited Use requirements.

## Permissions

| Permission | Why |
|---|---|
| `tabs` | to read the titles and addresses of your tabs; to open, close, reload or unload them when you ask; and to show a link opened from another app in the tab that already has it |
| `tabGroups` | to show top-level folders as tab groups |
| `webNavigation` | to tell links opened from other apps from links inside the browser |
| `storage` | to keep the tree, settings and statuses in your browser |
| `alarms` | to check connected sites for new statuses every 30 seconds while a site is connected |
| `clipboardWrite` | to copy links and the report when you ask |
| `sidePanel` (Chrome, Edge) | to show the panel in the side panel |
| optional site access | asked per site, only for the sites you connect in Settings › Statuses |

## Changes and contact

If this policy changes, the new version will be published here with a new date. Questions and requests:
[github.com/ReQur/TabTree/issues](https://github.com/ReQur/TabTree/issues).
