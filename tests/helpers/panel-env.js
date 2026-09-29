// Loads probe/panel.js into jsdom with a fake chrome API: the given tabs and stored tree, and recorders for
// what the panel does: messages to the background, tabs opened, closed, reloaded or unloaded, text copied,
// settings and the wallpaper written or removed, drag images set. Rows are 20px tall for drag and drop:
// y < 6 is the upper edge ("before"), y > 14 the lower edge ("after"), anything between is "inside".
// Icon-only buttons are found by their aria-label.
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
  const removed = [];
  const reloaded = [];
  const discarded = [];
  const copied = [];
  const sets = [];
  const dragImages = [];
  const storageListeners = [];
  const notify = changed => {
    for (const l of storageListeners) l({ [changed]: {} }, 'local');
  };
  const ev = () => ({ addListener() {} });
  const tabEvents = ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onActivated', 'onAttached', 'onDetached', 'onReplaced'];

  globalThis.chrome = {
    tabs: {
      query: async () => tabs.map(t => ({ ...t })),
      update: async id => activated.push(id),
      remove: async ids => removed.push(...[].concat(ids)),
      reload: async id => reloaded.push(id),
      discard: async id => discarded.push(id),
      ...Object.fromEntries(tabEvents.map(n => [n, ev()])),
    },
    tabGroups: { query: async () => [] },
    runtime: {
      // onMessage may change `store` like the background would, and returns the storage key it changed.
      sendMessage: async m => {
        sent.push(m);
        const changed = onMessage(m, store);
        if (changed) notify(changed);
        return { ok: true };
      },
    },
    storage: {
      local: {
        get: async k => Object.fromEntries([].concat(k).filter(x => x in store).map(x => [x, structuredClone(store[x])])),
        set: async items => {
          sets.push(structuredClone(items));
          Object.assign(store, structuredClone(items));
          for (const k of Object.keys(items)) notify(k);
        },
        remove: async keys => {
          for (const k of [].concat(keys)) {
            delete store[k];
            notify(k);
          }
        },
      },
      session: { get: async () => ({}) },
      onChanged: { addListener: fn => storageListeners.push(fn) },
    },
  };
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 0, height: 20 });
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async t => copied.push(t) }, configurable: true });
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
    e.dataTransfer = { setData() {}, setDragImage: img => dragImages.push(img.cloneNode(true)), effectAllowed: '' };
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
  const key = k => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));

  // Menus: the labels of the open menu (null when none is open), opening one, and using an item.
  const menuEl = () => $('.menu');
  const menu = () => (menuEl().hidden ? null : [...menuEl().querySelectorAll('.mi .label')].map(l => l.textContent));
  const hint = label => [...menuEl().querySelectorAll('.mi')].find(b => b.querySelector('.label').textContent === label)?.querySelector('.hint')?.textContent;
  const rightClick = target => {
    const e = new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
    (typeof target === 'string' ? row(target) : target).dispatchEvent(e);
    return e;
  };
  // A button's name: its aria-label, else its text.
  const label = b => b.getAttribute('aria-label') ?? b.textContent;
  const buttons = text => [...row(text).querySelectorAll('button')].map(label);
  const hoverButton = (text, name) => [...row(text).querySelectorAll('button')].find(b => label(b) === name);
  const more = text => hoverButton(text, 'More actions').click();
  const pick = label => {
    const item = [...menuEl().querySelectorAll('.mi')].find(b => b.querySelector('.label').textContent === label);
    if (!item) throw new Error(`no menu item «${label}» in ${JSON.stringify(menu())}`);
    item.click();
  };
  const mousedown = target => target.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
  const search = q => {
    $('#q').value = q;
    $('#q').dispatchEvent(new w.Event('input', { bubbles: true }));
  };

  return {
    w, $, rows, row, click, selected, fire, drag, key, sent, activated, removed, reloaded, discarded, copied, sets, store,
    dragImages, menu, hint, rightClick, more, pick, buttons, hoverButton, mousedown, search, last: () => sent.at(-1),
  };
}
