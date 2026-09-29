# TabTree

An Opera extension (Manifest V3, no build step) that shows tabs as a tree in Opera's sidebar:
- a tab hangs under the tab that opened it;
- tickets (`PROJ-123`) gather their merge requests and pipelines, and tickets opened from tickets nest;
- folders nest, and top-level folders are mirrored as Opera Tab Islands.

It is the repo owner's personal project (GitHub: ReQur), used daily in Opera on Windows.

Read before changing anything:
- [docs/FEATURES.md](docs/FEATURES.md): every behavior, from the user's side. Keep it true when behavior changes.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): stored data, commands, algorithms, verified Opera facts, tests.
- [docs/UI.md](docs/UI.md): the panel's UI with every state and token, what is weak in it, and the brief for a
  redesign.

## Ground rules

- **Language.** The owner writes in Russian, so answer in Russian. Everything the extension shows is English: panel
  text, the report, the manifest.
- **No work or corporate data** anywhere in this repo: code, tests, docs, commit metadata. Examples use `PROJ-123`,
  `jira.example.com`, `gitlab.example.com`.
- **Git identity.** It is personal and set in `.git/config`:
  - author: `Khabibullin Danil <45355757+ReQur@users.noreply.github.com>`;
  - the global git identity is a work one and must never be used here;
  - pushes go through `core.sshCommand = ssh -i ~/.ssh/githubssh -o IdentitiesOnly=yes`. That key has a passphrase.
    If a push fails with `Permission denied (publickey)`, ask the owner to push, or to run
    `ssh-add ~/.ssh/githubssh`. Don't try other keys.
- **Branches and pushes.** Branch names have no `/` (`design-tokens`, not `design/tokens`). Commit and push only
  when asked.
- **Don't move or rename `probe/`.** An unpacked extension's ID comes from its path, and a new ID starts with empty
  storage: the owner's folders and tree would be lost.

## Layout

```
probe/                 the extension, loaded unpacked as it is
  manifest.json        MV3, sidebar_action (Opera's sidebar API), permissions
  background.js        service worker, the only writer of the tree: openers, commands, snapshot/restore, tidy()
  tree.js              buildTree(): folders, placements, ticket rules, order (pure)
  titles.js            ticket keys, title cleanup, page kinds, row labels, names/colors for tickets (pure)
  snapshot.js          the snapshot and matching restored tabs back to it (pure)
  panel.html/.css/.js  the sidebar UI: draws the tree, sends commands, never writes the tree itself
  icons/               PNG icons
tests/                 scenario tests on fakes (jsdom, a fake Opera); helpers in tests/helpers/
docs/                  see above
```

## Working on it

- `npm install` once, then `npm test` after every change (about 10 s). The tests run against fakes only.
- Opera can't be run from here. It runs on the owner's Windows machine and loads `probe/` from
  `\\wsl.localhost\Ubuntu-22.04\home\qazar\projects\tabtrees\probe`. After a change:
  - ask the owner to press ↻ on the extension's card in `opera://extensions` (and to reopen the panel if it stays
    stale), then to check;
  - when something is unclear, ask for **Copy report** (the Log view shows the same). It lists Opera's APIs, tab and
    folder counts, the snapshot state and the recent events.
- Invariants (the reasons are in ARCHITECTURE.md):
  - Every change to the tree is a background command: `place`, `newFolder`, `renameFolder`, `colorFolder`,
    `deleteFolder`, `closeItems`, `allowAutoFolder`. The panel redraws from storage. It writes only `settings`
    itself.
  - Tab ids change with every browser session. Anything keyed by a tab id must go through the snapshot to survive a
    restart.
  - Islands are output only. Each top-level folder with 2+ tabs is an island; every other tab is kept out of
    islands. Opera keeps no one-tab islands.
  - A ticket's non-root pages always hang under the ticket's root. Tickets opened from tickets nest.
  - Openers must be captured in `tabs.onCreated`. In Opera, `openerTabId` read any later is unreliable.
  - `tabs.onRemoved` with `isWindowClosing` must not touch the tree or the snapshot: that is the browser shutting
    down.
- Update docs/FEATURES.md in the same change as the behavior it describes, plus UI.md or ARCHITECTURE.md where
  relevant.

## Code style

- Plain ES modules with no runtime dependencies; 2-space indent, single quotes, semicolons.
- Small named functions. The panel builds DOM with its `el()` and `button()` helpers.
- Comments explain why, as full sentences above the code, and are rare. Match the existing files.
