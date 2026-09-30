// Chrome for Testing (from Puppeteer's cache) in the new headless mode, with the screenshot copy of the extension,
// *.example.com mapped to the local fake sites, Segoe UI from the private fontconfig, and libgbm from screens/libs/
// (unpacked there from Ubuntu's .deb, since the system lacks it).
import path from 'node:path';
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch({ ext, port }) {
  const libs = path.join(HERE, 'libs/root/usr/lib/x86_64-linux-gnu');
  const env = { ...process.env, LANG: 'en_US.UTF-8', TZ: 'Europe/Berlin' };
  if (fs.existsSync(libs)) env.LD_LIBRARY_PATH = [libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  if (fs.existsSync(path.join(HERE, 'fonts/fonts.conf'))) env.FONTCONFIG_FILE = path.join(HERE, 'fonts/fonts.conf');
  const browser = await puppeteer.launch({
    headless: true,
    enableExtensions: [ext],
    pipe: true,
    env,
    defaultViewport: null,
    args: [
      `--host-resolver-rules=MAP *.example.com 127.0.0.1:${port}`,
      '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,LocalNetworkAccessChecks,PrivateNetworkAccessChecks',
      '--window-size=1500,1000',
      '--lang=en-US',
    ],
  });
  const sw = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().endsWith('/background.js'));
  const extId = new URL(sw.url()).host;
  const worker = await sw.worker();
  return { browser, worker, extId };
}

// Opens the sample tabs in the browser's window, in tab-strip order, each from its opener; closes the start tab;
// then places them into the folders (storage, as the background keeps it) and lets the background tidy (tab
// groups). Answers the window and the tab ids by the sample's local ids.
export async function buildScene(worker, { tabs, folders, active }) {
  const scene = await worker.evaluate(async tabs => {
    // No automatic folders while the tabs come in one by one: the families are put into folders below.
    await chrome.storage.local.set({ settings: { onboarded: true, autoFolders: false } });
    const [win] = await chrome.windows.getAll({ windowTypes: ['normal'] });
    const start = await chrome.tabs.query({ windowId: win.id });
    const ids = {};
    let index = start.length;
    for (const t of tabs) {
      const created = await chrome.tabs.create({
        windowId: win.id,
        url: t.url,
        pinned: !!t.pinned,
        active: false,
        index: index++,
        ...(t.under ? { openerTabId: ids[t.under] } : {}),
      });
      ids[t.id] = created.id;
      await new Promise(r => setTimeout(r, 120));
    }
    await chrome.tabs.remove(start.map(t => t.id));
    return { windowId: win.id, ids };
  }, tabs);

  // Every page loaded, with its title and favicon.
  for (let i = 0; i < 100; i++) {
    const pending = await worker.evaluate(async windowId => (await chrome.tabs.query({ windowId }))
      .filter(t => t.status !== 'complete' || !t.favIconUrl || t.title === t.url).length, scene.windowId);
    if (!pending) break;
    await sleep(200);
  }
  await sleep(1500);

  await worker.evaluate(async ({ tabs, folders, ids }) => {
    const now = Date.now();
    const stored = {};
    folders.forEach((f, i) => {
      stored[f.id] = { name: f.name, color: f.color, parent: f.parent, created: now + i };
    });
    const { parents = {} } = await chrome.storage.local.get('parents');
    for (const t of tabs) {
      const id = ids[t.id];
      if (t.folder) parents[id] = `f:${t.folder}`;
      else if (t.under) parents[id] = ids[t.under];
      else if (t.top) parents[id] = -1;
    }
    // Two tickets whose automatic folder was once deleted: Settings › Never for lists them.
    await chrome.storage.local.set({ folders: stored, parents, declined: { 'PROJ-88': true, 'PROJ-97': true } });
    // Automatic folders on again (the default): a change of settings also runs the tab-group mirror.
    await chrome.storage.local.set({ settings: { onboarded: true } });
  }, { tabs, folders, ids: scene.ids });

  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), scene.ids[active]);
  return scene;
}

// Waits until the watch has stored the statuses of every sample page, and the sites answered.
export async function waitForStatuses(worker, want, timeout = 90_000) {
  const until = Date.now() + timeout;
  let last = null;
  while (Date.now() < until) {
    last = await worker.evaluate(async () => {
      const { status = {} } = await chrome.storage.local.get('status');
      const count = m => Object.keys(status[m] ?? {}).length;
      return { tickets: count('tickets'), mrs: count('mrs'), builds: count('builds'), sites: status.sites ?? {} };
    });
    const sitesOk = Object.values(last.sites).filter(s => s.ok).length;
    if (last.tickets >= want.tickets && last.mrs >= want.mrs && last.builds >= want.builds && sitesOk >= want.sites) return last;
    await sleep(1000);
  }
  throw new Error(`statuses not in after ${timeout / 1000} s: ${JSON.stringify(last)}`);
}

// sidePanel.open() needs a user gesture: a click on helper.html's button, in a window of its own (a tab in the
// sample window would show up in the tree). The panel then belongs to the sample window.
export async function openSidePanel(browser, worker, extId, windowId) {
  const helperWindow = await worker.evaluate(async url => (await chrome.windows.create({ url, focused: false })).id,
    `chrome-extension://${extId}/helper.html?window=${windowId}`);
  const helperTarget = await browser.waitForTarget(t => t.url().includes('/helper.html'));
  const helper = await helperTarget.asPage();
  await helper.waitForSelector('#open');
  await helper.click('#open');
  const target = await browser.waitForTarget(t => t.url() === `chrome-extension://${extId}/panel.html`, { timeout: 10_000 });
  const title = await helper.title();
  if (title !== 'opened') throw new Error(`sidePanel.open: ${title}`);
  await worker.evaluate(id => chrome.windows.remove(id), helperWindow);
  return target.asPage();
}
