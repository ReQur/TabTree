// Loads probe/panel.js into jsdom with a fake chrome API: the given tabs and stored tree, and a recorder for
// the messages the panel sends to the background. Rows are 20px tall for drag and drop: y < 6 is the upper
// edge ("before"), y > 14 the lower edge ("after"), anything between is "inside".
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { wait } from './check.js';

export async function loadPanel({ tabs, store, onMessage = () => {} }) {
  const html = fs
    .readFileSync(new URL('../../probe/panel.html', import.meta.url), 'utf8')
    .replace(/<script[^>]*><\/script>/, '');
  const dom = new JSDOM(html, { url: 'https://panel.test/', pretendToBeVisual: true });
  const w = dom.window;
  const sent = [];
  const activated = [];
  const storageListeners = [];
  const ev = () => ({ addListener() {} });
  const tabEvents = ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onActivated', 'onAttached', 'onDetached', 'onReplaced'];

  globalThis.chrome = {
    tabs: {
      query: async () => tabs.map(t => ({ ...t })),
      update: async id => activated.push(id),
      remove: async () => {},
      ...Object.fromEntries(tabEvents.map(n => [n, ev()])),
    },
    tabGroups: { query: async () => [] },
    runtime: {
      // onMessage may change `store` like the background would, and returns the storage key it changed.
      sendMessage: async m => {
        sent.push(m);
        const changed = onMessage(m, store);
        if (changed) for (const l of storageListeners) l({ [changed]: {} }, 'local');
        return { ok: true };
      },
    },
    storage: {
      local: {
        get: async k => Object.fromEntries([].concat(k).filter(x => x in store).map(x => [x, structuredClone(store[x])])),
        set: async () => {},
      },
      session: { get: async () => ({}) },
      onChanged: { addListener: fn => storageListeners.push(fn) },
    },
  };
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 0, height: 20 });
  Object.assign(globalThis, { window: w, document: w.document, localStorage: w.localStorage });
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });

  await import('../../probe/panel.js');
  await wait(300);

  const $ = sel => w.document.querySelector(sel);
  const rows = () => [...w.document.querySelectorAll('#list .row')];
  const row = text => rows().find(r => r.textContent.includes(text));
  const click = (text, mods = {}) => row(text).dispatchEvent(new w.MouseEvent('click', { bubbles: true, ...mods }));
  const selected = () => rows().filter(r => r.classList.contains('selected')).map(r => r.querySelector('.title').textContent);
  const fire = (target, type, y = 10) => {
    const e = new w.Event(type, { bubbles: true, cancelable: true });
    e.dataTransfer = { setData() {}, effectAllowed: '' };
    e.clientY = y;
    target.dispatchEvent(e);
    return e;
  };
  // Drags one row onto another at height y; returns whether the target accepted it.
  const drag = (from, to, y) => {
    fire(row(from), 'dragstart');
    const over = fire(row(to), 'dragover', y);
    if (over.defaultPrevented) fire(row(to), 'drop', y);
    fire(row(from) ?? w.document.body, 'dragend');
    return over.defaultPrevented;
  };
  const key = k => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k }));
  return { w, $, rows, row, click, selected, fire, drag, key, sent, activated, last: () => sent.at(-1) };
}
