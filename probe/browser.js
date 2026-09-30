// The browser the extension runs in, and the words the panel uses for it. Opera has islands, workspaces and a sidebar
// of its own; Chrome and Edge have tab groups and a side panel that opens from the toolbar. Pure.

const OPERA = {
  id: 'opera',
  name: 'Opera',
  version: /OPR\/([\d.]+)/,
  group: 'island',
  aGroup: 'an island',
  Groups: 'Islands',
  short: 'Islands',
  oneTab: 'Opera keeps no one-tab islands',
  needsTwo: 'Opera needs 2',
  workspaces: true,
  setup: [
    ['pin', 'Pin this panel', "The pin in the panel's title bar keeps it next to the page."],
    ['tabs', "Collapse Opera's tabs", 'Settings › Browser › Tabs: vertical tabs, collapsed to a column of icons.'],
    ['islands', 'Turn off automatic Tab Islands', 'Branchy makes islands from your folders.'],
  ],
  setupLine: "Pin the panel, collapse Opera's tab strip, turn off Opera's own Tab Islands.",
};

const CHROME = {
  id: 'chrome',
  name: 'Chrome',
  version: /Chrome\/([\d.]+)/,
  group: 'tab group',
  aGroup: 'a tab group',
  Groups: 'Tab groups',
  short: 'Groups',
  oneTab: 'a folder needs two tabs for one',
  needsTwo: 'needs 2',
  workspaces: false,
  setup: [
    ['pin', 'Pin Branchy', 'Extensions (the puzzle piece) › the pin next to Branchy. Its button opens this panel.'],
    ['left', 'Put the side panel on the left', "Chrome's Settings › Appearance › Side panel: Show on left."],
  ],
  setupLine: 'Pin Branchy to the toolbar, put the side panel on the left.',
};

const EDGE = {
  ...CHROME,
  id: 'edge',
  name: 'Edge',
  version: /Edg\/([\d.]+)/,
  setup: [
    ['pin', 'Pin Branchy', 'Extensions (the puzzle piece) › the eye next to Branchy. Its button opens this panel in the sidebar.'],
    ['tabs', "Collapse Edge's tabs", 'Right-click a tab › Turn on vertical tabs, then collapse them to a column of icons.'],
  ],
  setupLine: "Pin Branchy to the toolbar, collapse Edge's tabs to a column of icons.",
};

// Opera's pages have the `opr` object, and Opera and Edge name themselves in the user agent ("OPR/", "Edg/").
export function browserOf(ua = '', opr) {
  if (opr || /\bOPR\//.test(ua)) return OPERA;
  if (/\bEdg\//.test(ua)) return EDGE;
  return CHROME;
}
