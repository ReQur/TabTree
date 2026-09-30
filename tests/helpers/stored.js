// What Opera's storage gives back: a copy, through JSON, with every object's keys in alphabetical order (Chromium
// keeps stored objects as sorted dictionaries). Code that compares stored values has to cope with that.
export const asStored = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value, (_, v) => (
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v))));
