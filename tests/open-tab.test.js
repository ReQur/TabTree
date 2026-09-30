// A tab the panel opens (probe/background.js, openTab): it hangs where the panel says, not under the tab in view,
// which Opera gives a tab made by an extension as its opener.
import { check, wait, done } from './helpers/check.js';
import { makeOpera } from './helpers/opera-fake.js';

const PIPELINE = 'https://gitlab.example.com/group/app/-/pipelines/6';
const o = makeOpera({
  tabs: [
    { id: 1, title: 'nightly [Jenkins]', url: 'https://ci.example.com/job/nightly/', active: true },
    { id: 2, title: 'PROJ-1: Fix (!42) · Merge requests · group / app · GitLab', url: 'https://gitlab.example.com/group/app/-/merge_requests/42' },
  ],
  local: { folders: {}, parents: {} },
});
await import('../probe/background.js');
await wait(300);

const reply = await o.ask({ type: 'openTab', url: PIPELINE, parent: 2 });
await wait(100);
const made = [...o.tabs.values()].find(t => t.pendingUrl === PIPELINE);
check(`Opera gives the new tab the tab in view as its opener: #${made?.openerTabId}`, made?.openerTabId === 1);
check(`yet it hangs under the merge request whose card opened it: under ${o.local.parents[made?.id]}`, reply.ok && o.local.parents[made.id] === 2);
await o.ask({ type: 'openTab', url: 'https://gitlab.example.com/', parent: -1 });
await wait(100);
const signIn = [...o.tabs.values()].find(t => t.pendingUrl === 'https://gitlab.example.com/');
check('a page to sign in goes to the top level', o.local.parents[signIn.id] === -1);
const odd = await o.ask({ type: 'openTab', url: 'javascript:alert(1)', parent: -1 });
check(`only web pages: ${odd.error}`, odd.ok === false);
done();
