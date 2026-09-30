// Links from other apps (probe/background.js): a page opened from outside the browser that a tab already shows goes
// to that tab, reloaded at the link's address, and the new copy closes; otherwise it stays, on the top level. Links
// inside the browser are left alone, and so is the first half minute of a session.
import { check, wait, done } from './helpers/check.js';
import { makeOpera } from './helpers/opera-fake.js';

const MR = 'https://gitlab.example.com/group/app/-/merge_requests/560';
const o = makeOpera({
  tabs: [
    { id: 1, title: 'nightly [Jenkins]', url: 'https://ci.example.com/job/nightly/', active: true, lastAccessed: 900 },
    { id: 2, title: 'PROJ-1: Fix (!560) · Merge requests · group / app · GitLab', url: `${MR}/diffs`, lastAccessed: 50 },
  ],
  local: { folders: {}, parents: {} },
  // A session that started a while ago.
  session: { sid: Date.now() - 60_000 },
});
await import('../probe/background.js');
await wait(300);
const commit = (tabId, url, transitionType) => o.listeners.committed({ tabId, frameId: 0, url, transitionType, transitionQualifiers: [] });
const events = kind => (o.local.log ?? []).filter(e => e.ev === kind);

// Claude Code opens the merge request: Opera makes a tab, which starts loading the page.
o.open(10, '', `${MR}#note_42`, { openerTabId: 1, active: true });
commit(10, `${MR}#note_42`, 'start_page');
await wait(200);
check(`the tab that shows it goes to the link's address, and comes forward: ${JSON.stringify(o.updates.at(-1))}`,
  o.updates.at(-1)?.[0] === 2 && o.updates.at(-1)[1].url === `${MR}#note_42` && o.updates.at(-1)[1].active && o.focused.at(-1)?.[0] === 1);
check('the new copy closes', !o.tabs.has(10));
check(`and the log says so: ${JSON.stringify(events('reused').at(-1))}`, events('reused').at(-1)?.id === 2 && events('reused').at(-1).closed === 10 && events('opened').at(-1)?.transition === 'start_page');

o.open(11, '', MR, { openerTabId: 2 });
commit(11, MR, 'link');
await wait(200);
check('a link opened inside the browser opens as always, and stays out of the log', o.tabs.has(11) && o.updates.length === 1 && !events('opened').some(e => e.id === 11));

o.open(12, '', 'https://example.com/new', { openerTabId: 1 });
commit(12, 'https://example.com/new', 'start_page');
await wait(200);
check(`a page from another app that isn't open stays, on the top level rather than under the tab in view: ${o.local.parents[12]}`, o.tabs.has(12) && o.local.parents[12] === -1);

await o.chrome.storage.local.set({ settings: { reuseTabs: false } });
o.open(13, '', MR, { openerTabId: 1 });
commit(13, MR, 'start_page');
await wait(200);
check('switched off in Settings: the copy stays', o.tabs.has(13) && o.updates.length === 1);

await o.chrome.storage.local.set({ settings: {} });
o.session.sid = Date.now();
o.open(14, '', MR, { openerTabId: 1 });
commit(14, MR, 'start_page');
await wait(200);
check('in the first half minute of a session, when restored tabs load: left alone', o.tabs.has(14) && o.updates.length === 1);
done();
