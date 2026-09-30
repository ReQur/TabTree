// Keeping the tree across browser restarts. Tab ids change on restart, so the tree is saved against tab
// positions and URLs, and the restored tabs are matched back by URL in tab-strip order.

const bare = url => (url || '').split('#')[0];

// A stable order: window by window (ids grow with window age), then by position in the window.
function ordered(tabs) {
  return tabs.filter(t => !t.incognito).sort((a, b) => a.windowId - b.windowId || a.index - b.index);
}

// `parents` maps a tab id to where the tab is placed: a parent tab's id, a folder ("f:<id>"), or -1 for the
// top level. A parent tab is saved as its position in the snapshot; folders keep their ids across restarts.
// `ranks` holds the order among siblings ("t:<tab id>" → number).
export function snapshotOf(tabs, parents, ranks = {}) {
  const list = ordered(tabs);
  const pos = new Map(list.map((t, i) => [t.id, i]));
  return list.map(t => {
    const p = parents[t.id];
    const rank = ranks[`t:${t.id}`];
    return {
      url: bare(t.url || t.pendingUrl),
      title: t.title ?? '',
      parent: typeof p === 'string' || p === -1 ? p : (pos.get(p) ?? null),
      ...(rank != null && { rank }),
    };
  });
}

// Saved position → restored tab id. Opera restores tabs in the same order with the same URLs, so equal
// URLs are paired in order (a tab that moved is still found by its URL). Tabs whose URL changed, say by a
// login redirect on reload, are paired by position when they fill the gap between matched neighbours
// one to one.
export function matchTabs(saved, current) {
  const list = ordered(current);
  const byUrl = new Map();
  list.forEach((t, i) => {
    const k = bare(t.url || t.pendingUrl);
    if (!byUrl.has(k)) byUrl.set(k, []);
    byUrl.get(k).push(i);
  });
  const used = new Set();
  const at = saved.map(() => -1); // saved position -> position in `list`
  let cursor = 0;
  saved.forEach((s, i) => {
    const candidates = byUrl.get(s.url) ?? [];
    const next = candidates.find(c => !used.has(c) && c >= cursor) ?? candidates.find(c => !used.has(c));
    if (next === undefined) return;
    used.add(next);
    at[i] = next;
    cursor = next + 1;
  });

  for (let i = 0; i < saved.length; i++) {
    if (at[i] !== -1) continue;
    let end = i;
    while (end < saved.length && at[end] === -1) end++;
    const from = i > 0 ? at[i - 1] : -1;
    const to = end < saved.length ? at[end] : list.length;
    const gap = [];
    for (let c = from + 1; c < to; c++) if (!used.has(c)) gap.push(c);
    if (from < to && gap.length === end - i) {
      gap.forEach((c, k) => {
        used.add(c);
        at[i + k] = c;
      });
    }
    i = end;
  }
  return new Map(at.flatMap((c, i) => (c === -1 ? [] : [[i, list[c].id]])));
}

// Parent links for the restored tabs. A tab whose saved parent was not restored goes under the nearest
// saved ancestor that was. A chain of parents that runs in a circle (an imported file can hold anything) ends
// where it comes round.
export function restoredParents(saved, match) {
  const parents = {};
  saved.forEach((s, i) => {
    const child = match.get(i);
    if (child === undefined) return;
    let p = s.parent;
    const seen = new Set();
    while (typeof p === 'number' && p !== -1 && !match.has(p) && !seen.has(p)) {
      seen.add(p);
      p = saved[p]?.parent;
    }
    if (typeof p === 'number' && p !== -1 && !match.has(p)) return;
    if (p === -1 || typeof p === 'string') parents[child] = p;
    else if (p != null) parents[child] = match.get(p);
  });
  return parents;
}

export function restoredRanks(saved, match) {
  const ranks = {};
  saved.forEach((s, i) => {
    if (s.rank != null && match.has(i)) ranks[`t:${match.get(i)}`] = s.rank;
  });
  return ranks;
}
