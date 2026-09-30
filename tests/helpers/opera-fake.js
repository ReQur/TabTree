// A small fake of the Opera APIs that probe/background.js uses: tabs with islands (tab groups), storage,
// and the events the background listens to. Empty islands vanish, as they do in Opera. Sites given access to
// (`granted`, then grant() / revoke()) and alarms are faked too; the network isn't: set globalThis.fetch.
//
// Storage gives back what Opera's does: copies with their keys sorted (see stored.js).
//
// makeOpera() puts the fake on globalThis.chrome; import the background afterwards. A second session in the
// same process needs a fresh module instance: import('../probe/background.js?session=2').

import { asStored } from './stored.js';

export function makeOpera({ tabs: initial = [], groups: initialGroups = [], local = {}, session = {}, granted: given = [] } = {}) {
  const listeners = {};
  const storageListeners = [];
  const on = name => ({ addListener: fn => { listeners[name] = fn; } });
  const defaults = { windowId: 1, pinned: false, groupId: -1, workspaceId: 'w', status: 'complete', title: '' };
  const tabs = new Map(initial.map(t => [t.id, { ...defaults, index: t.id, ...t }]));
  const granted = new Set(given);
  const alarms = new Map();
  const groups = new Map(initialGroups.map(g => [g.id, { windowId: 1, ...g }]));
  let nextGroup = 500;
  let nextTab = 1000;
  const updates = []; // [tab id, what tabs.update was given]
  const focused = []; // windows focused
  const snap = id => ({ ...tabs.get(id) });
  const dropIfEmpty = gid => {
    if (gid !== -1 && ![...tabs.values()].some(t => t.groupId === gid)) groups.delete(gid);
  };
  const setGroup = (id, gid) => {
    const old = tabs.get(id).groupId;
    tabs.get(id).groupId = gid;
    dropIfEmpty(old);
    listeners.updated?.(id, { groupId: gid }, snap(id));
  };
  const close = id => {
    const gid = tabs.get(id).groupId;
    tabs.delete(id);
    dropIfEmpty(gid);
    listeners.removed?.(id, { windowId: 1, isWindowClosing: false });
  };

  const chrome = {
    storage: {
      local: {
        get: async k => Object.fromEntries((Array.isArray(k) ? k : [k]).filter(x => x in local).map(x => [x, asStored(local[x])])),
        set: async o => {
          Object.assign(local, structuredClone(o));
          const changes = Object.fromEntries(Object.keys(o).map(k => [k, { newValue: o[k] }]));
          for (const fn of storageListeners) fn(changes, 'local');
        },
        remove: async keys => [].concat(keys).forEach(k => delete local[k]),
      },
      session: {
        get: async k => (k in session ? { [k]: asStored(session[k]) } : {}),
        set: async o => Object.assign(session, structuredClone(o)),
      },
      onChanged: { addListener: fn => storageListeners.push(fn) },
    },
    tabs: {
      get: async id => {
        if (!tabs.has(id)) throw new Error(`No tab with id: ${id}`);
        return snap(id);
      },
      query: async (q = {}) => [...tabs.keys()].map(snap).filter(t => q.groupId == null || t.groupId === q.groupId),
      group: async ({ groupId, tabIds }) => {
        const gid = groupId ?? nextGroup++;
        if (!groups.has(gid)) groups.set(gid, { id: gid, title: '', color: 'grey', windowId: 1 });
        tabIds.forEach(id => setGroup(id, gid));
        return gid;
      },
      ungroup: async tabIds => tabIds.forEach(id => setGroup(id, -1)),
      update: async (id, props) => {
        if (!tabs.has(id)) throw new Error(`No tab with id: ${id}`);
        const tab = tabs.get(id);
        updates.push([id, props]);
        if (props.url) tab.url = props.url;
        if (props.active) for (const t of tabs.values()) t.active = t.id === id || (t.active && t.windowId !== tab.windowId);
        return snap(id);
      },
      // As Opera does, a tab made by an extension gets the tab in view as its opener, whatever it was asked for.
      create: async ({ url, active = true } = {}) => {
        const id = nextTab++;
        const inView = [...tabs.values()].find(t => t.active);
        tabs.set(id, { ...defaults, id, index: tabs.size, url: '', pendingUrl: url, active, openerTabId: inView?.id });
        listeners.created(snap(id));
        return snap(id);
      },
      remove: async ids => [].concat(ids).forEach(close),
      onCreated: on('created'),
      onRemoved: on('removed'),
      onReplaced: on('replaced'),
      onUpdated: on('updated'),
      onMoved: on('moved'),
      onAttached: on('attached'),
      onDetached: on('detached'),
    },
    tabGroups: {
      query: async () => [...groups.values()].map(g => ({ ...g })),
      update: async (gid, p) => {
        if (!groups.has(gid)) throw new Error(`No group with id: ${gid}`);
        Object.assign(groups.get(gid), p);
      },
    },
    permissions: {
      getAll: async () => ({ origins: [...granted], permissions: [] }),
      onAdded: on('permissionsAdded'),
      onRemoved: on('permissionsRemoved'),
    },
    alarms: {
      create: async (name, info) => void alarms.set(name, { name, ...info }),
      get: async name => alarms.get(name),
      clear: async name => alarms.delete(name),
      onAlarm: on('alarm'),
    },
    webNavigation: { onCreatedNavigationTarget: on('navTarget'), onCommitted: on('committed') },
    windows: { update: async (id, props) => void focused.push([id, props]) },
    runtime: { onInstalled: on('installed'), onStartup: on('startup'), onMessage: on('message') },
  };
  globalThis.chrome = chrome;

  // A tab opened by the user (or by a link on another tab: pass openerTabId).
  const open = (id, title, url, extra = {}) => {
    tabs.set(id, { ...defaults, id, index: id, title, url, ...extra });
    listeners.created(snap(id));
  };
  // What the panel would send, answered the way chrome.runtime.sendMessage answers.
  const ask = msg => new Promise(r => listeners.message(msg, {}, r));
  // Access to a site given or taken back in Settings, as Opera reports it.
  const grant = origin => {
    granted.add(origin);
    listeners.permissionsAdded?.({ origins: [origin] });
  };
  const revoke = origin => {
    granted.delete(origin);
    listeners.permissionsRemoved?.({ origins: [origin] });
  };
  return { chrome, listeners, tabs, groups, local, session, alarms, updates, focused, open, close, ask, setGroup, grant, revoke };
}
