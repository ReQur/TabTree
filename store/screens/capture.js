// Captures the real Branchy panel, in Chrome's real side panel, for the store screenshots: raw/*.png and
// raw/meta.json. Run by make.js; `node capture.js` alone also works. See README in index.html.
import fs from 'node:fs';
import path from 'node:path';
import { prepareExtension } from './lib/prepare.js';
import { startServer } from './lib/server.js';
import { launch, buildScene, waitForStatuses, openSidePanel } from './lib/browser.js';
import { makeWallpaper } from './lib/wallpaper.js';
import { TABS, FOLDERS, ACTIVE } from './lib/sample.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const RAW = path.join(HERE, 'raw');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The panel's size in CSS pixels, and the scale it is drawn at: the capture is PANEL × SCALE pixels, shown 1:1 on
// the 1280×800 canvas, so text is rendered at that size instead of being resampled.
export const PANEL = { width: 376, height: 684, scale: 1.1 };
// The details card's callout is drawn larger than the panel.
const CARD_SCALE = 1.3;
// Settings: the section at the top of the screenshot.
const SETTINGS_FROM = 'Tree';
// The wallpaper's Dim (%) and its place behind the panel (x, %).
const WALL = { dim: 60, x: 40 };
// Search: the query of the screenshot, and others captured to compare (raw/3-search-<query>.png).
export const QUERIES = ['checkout', 'mr'];

export async function capture({ only = null, log = false } = {}) {
  fs.mkdirSync(RAW, { recursive: true });
  const ext = path.join(HERE, 'ext');
  await prepareExtension(ext);
  const wallFile = makeWallpaper(path.join(RAW, 'wallpaper.png'));
  const server = await startServer({ log });
  const { browser, worker, extId } = await launch({ ext, port: server.port });
  // A run of some shots only keeps what the others' last run found (the card's place, for the callout).
  const metaFile = path.join(RAW, 'meta.json');
  const kept = only && fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')).shots : {};
  const meta = { panel: PANEL, shots: { ...kept } };
  try {
    const scene = await buildScene(worker, { tabs: TABS, folders: FOLDERS, active: ACTIVE });
    const got = await waitForStatuses(worker, { tickets: 6, mrs: 5, builds: 1, sites: 3 });
    if (log) console.log('statuses', got);
    const panel = await openSidePanel(browser, worker, extId, scene.windowId);
    panel.on('console', m => log && console.log('panel:', m.text()));
    panel.on('pageerror', e => console.error('panel error:', e.message));
    await panel.setViewport({ width: PANEL.width, height: PANEL.height, deviceScaleFactor: PANEL.scale });
    await panel.waitForSelector('#list .row');
    // The mouse rests on the empty end of the pinned row, where hovering changes nothing. (In this emulated side
    // panel, mouse coordinates seem to be taken in device pixels, so clicks go through the DOM instead.)
    const park = () => panel.mouse.move(PANEL.width - 40, 52);
    const click = sel => panel.$eval(sel, e => e.click());
    const theme = value => panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value }]);
    const settle = (ms = 700) => sleep(ms);
    const shot = async (name, extra = {}) => {
      await panel.screenshot({ path: path.join(RAW, `${name}.png`) });
      meta.shots[name] = extra;
      console.log(`raw/${name}.png`);
    };
    const want = n => !only || only.includes(n);
    const ref = id => `[data-ref="t:${scene.ids[id]}"]`;
    const fold = async sel => {
      await click(sel);
      await settle(300);
    };
    await theme('dark');
    await park();
    await settle(1500);

    if (want(1)) {
      await shot('1-tree');
    }

    if (want(2)) {
      // Statuses: the tree with its lines and marks, and the details card of a merge request whose pipeline runs.
      await fold('[data-folder="dash"]');
      await park();
      await settle();
      await shot('2-statuses');
      await click(`${ref('mr812')} .stc`);
      await panel.waitForSelector('.pop');
      await park();
      await settle(600);
      const rects = await panel.evaluate(sel => {
        const r = e => {
          const b = e.getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        };
        return { card: r(document.querySelector('.pop')), row: r(document.querySelector(sel).closest('.row')), status: r(document.querySelector(sel)) };
      }, `${ref('mr812')} .stc`);
      await shot('2-statuses-card', rects);
      // The card alone, larger and without its caret or the panel around it, for a callout beside the panel.
      await panel.setViewport({ width: PANEL.width, height: PANEL.height, deviceScaleFactor: CARD_SCALE });
      await panel.addStyleTag({ content: 'html, body { background: transparent !important; } body > :not(.pop) { visibility: hidden !important; } .pop { box-shadow: inset 0 0 0 1px var(--line) !important; } .pop .caret { display: none !important; }' });
      await settle(500);
      await (await panel.$('.pop')).screenshot({ path: path.join(RAW, '2-card.png'), omitBackground: true });
      console.log('raw/2-card.png');
      await panel.evaluate(() => document.querySelector('style:last-of-type').remove());
      await panel.setViewport({ width: PANEL.width, height: PANEL.height, deviceScaleFactor: PANEL.scale });
      await panel.keyboard.press('Escape');
      await settle(300);
      await fold('[data-folder="dash"]');
    }

    if (want(3)) {
      for (const [i, q] of QUERIES.entries()) {
        // Esc clears the field but leaves the focus in it, where / is just a character.
        await panel.$eval('#q', e => e.blur());
        await panel.keyboard.press('/');
        await panel.keyboard.type(q, { delay: 60 });
        await park();
        await settle();
        await shot(i ? `3-search-${q}` : '3-search', { query: q });
        await panel.keyboard.press('Escape');
        await settle(400);
      }
    }

    if (want(4)) {
      await theme('light');
      await click('#open-settings');
      await settle(600);
      const top = await panel.evaluate(from => {
        const list = document.querySelector('#list');
        const sub = [...document.querySelectorAll('.settings .sub')].find(s => s.textContent === from);
        list.scrollTop = sub.offsetTop - 6;
        return list.scrollTop;
      }, SETTINGS_FROM);
      await park();
      await settle(500);
      await shot('4-settings', { scrollTop: top });
      await click('#back');
      await settle(400);
      await theme('dark');
    }

    if (want(5)) {
      await click('#open-settings');
      await settle(500);
      const input = await panel.$('#wp-input');
      await input.uploadFile(wallFile);
      await panel.waitForSelector('.slice', { timeout: 20_000 });
      await settle(800);
      // Less dim than the 70% default, and the frame a little to the left, as one would set them.
      await panel.$eval('#wp-dim', (e, dim) => {
        e.value = String(dim);
        e.dispatchEvent(new Event('input'));
        e.dispatchEvent(new Event('change'));
      }, WALL.dim);
      await panel.focus('#wp-frame');
      for (let x = 50; x > WALL.x; x -= 5) await panel.keyboard.press('ArrowLeft');
      await settle(800);
      await panel.evaluate(() => (document.querySelector('#list').scrollTop = 0));
      await shot('5-wallpaper-settings');
      await click('#back');
      await settle(400);
      await park();
      await settle(800);
      await shot('5-wallpaper');
      // Leave no picture behind for the next run's first shots (the profile is thrown away anyway).
    }
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
  return meta;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const onlyArg = process.argv.find(a => a.startsWith('--only='));
  await capture({ only: onlyArg ? onlyArg.slice(7).split(',').map(Number) : null, log: process.argv.includes('--log') });
}
