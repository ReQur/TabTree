// The panel's icons: a 16px grid, 1.5px strokes with round ends, drawn in currentColor (`.i` in panel.css).
// Each icon is a list of shapes; icon(name) clones an <svg> built once per name.

const NS = 'http://www.w3.org/2000/svg';

const path = (d, width) => ['path', width ? { d, 'stroke-width': width } : { d }];
const circle = (cx, cy, r) => ['circle', { cx, cy, r }];
const rect = (x, y, width, height, rx) => ['rect', { x, y, width, height, rx }];

const FOLDER = 'M1.75 4.25c0-.55.45-1 1-1h3.1l1.5 1.5h5.9c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1z';

export const ICONS = {
  twisty: [path('M6 4l4 4-4 4')],
  search: [circle(7, 7, 4.25), path('M10.25 10.25l3.25 3.25')],
  newFolder: [path(FOLDER), path('M8 7.25v3.5M6.25 9h3.5')],
  log: [path('M1.75 8h2.5l1.75-4.5 4 9 1.75-4.5h2.5')],
  settings: [path('M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7'), circle(10.5, 4.5, 1.5), circle(5.5, 11.5, 1.5)],
  more: [path('M3.5 8h.01M8 8h.01M12.5 8h.01', 2.25)],
  close: [path('M4.5 4.5l7 7M11.5 4.5l-7 7')],
  drag: [path('M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01', 2)],
  rename: [path('M10.5 2.75l2.75 2.75L6 12.75l-3.5.75.75-3.5z')],
  color: [path('M8 2.25s4.25 4.4 4.25 7.25a4.25 4.25 0 0 1-8.5 0C3.75 6.65 8 2.25 8 2.25z')],
  copy: [
    rect(5.5, 5.5, 8, 8, 1.5),
    path('M10.5 5.5V3.75c0-.69-.56-1.25-1.25-1.25h-5.5c-.69 0-1.25.56-1.25 1.25v5.5c0 .69.56 1.25 1.25 1.25H5.5'),
  ],
  delete: [path('M2.75 4.5h10.5M6.25 4.5V3h3.5v1.5M4 4.5l.75 9h6.5l.75-9')],
  toFolder: [path(FOLDER), path('M5.5 9h5M8.5 7l2 2-2 2')],
  closeTabs: [rect(2, 3, 12, 10, 2), path('M6 6.5l4 4M10 6.5l-4 4')],
  back: [path('M13 8H3.5M7.5 4l-4 4 4 4')],
  done: [path('M3 8.5l3 3 7-7')],
  warning: [path('M8 2.5l6 11H2z'), path('M8 6.5v3M8 11.5h.01')],
  mr: [
    circle(4.5, 3.5, 1.5),
    circle(4.5, 12.5, 1.5),
    circle(11.5, 12.5, 1.5),
    path('M4.5 5v6M11.5 11V8.5c0-2-1.5-3-3.5-3H6'),
  ],
  pipeline: [circle(3, 8, 1.75), circle(8, 8, 1.75), circle(13, 8, 1.75), path('M4.75 8h1.5M9.75 8h1.5')],
  job: [rect(2.5, 2.5, 11, 11, 2), path('M6.5 5.75v4.5l3.75-2.25z')],
  build: [path('M8 1.75l5.5 3.1v6.3L8 14.25l-5.5-3.1v-6.3z'), path('M2.5 4.85L8 8l5.5-3.15M8 8v6.25')],
  sound: [path('M2.5 6v4h2.5l3.5 3V3L5 6z'), path('M11 5.5a3.5 3.5 0 0 1 0 5')],
  workspace: [path('M8 2.5l6 3-6 3-6-3z'), path('M2 10.5l6 3 6-3')],
  noDrop: [circle(8, 8, 5.5), path('M4.1 4.1l7.8 7.8')],
  dropZone: [path('M8 2.5v8M4.5 7l3.5 3.5L11.5 7'), path('M2.5 13.5h11')],
  emptyTree: [
    rect(1.75, 2, 5, 3.5, 1),
    rect(9.25, 6.25, 5, 3.5, 1),
    rect(9.25, 10.5, 5, 3.5, 1),
    path('M4.25 5.5v6.75h5M4.25 8h5'),
  ],
  pin: [path('M6 2.5h4l-.5 4 2 2v1h-7v-1l2-2z'), path('M8 9.5v4')],
};

// The folder glyph in a folder row's favicon column: filled with the folder's color (`.dot` in panel.css).
const GLYPHS = {
  folder: [path('M1.5 4.5c0-.83.67-1.5 1.5-1.5h3.1l1.5 1.5H13c.83 0 1.5.67 1.5 1.5v5.5c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5z')],
};

const built = new Map();

function build(shapes) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs)) shape.setAttribute(name, value);
    svg.append(shape);
  }
  return svg;
}

export function icon(name, cls = 'i') {
  if (!built.has(name)) built.set(name, build(ICONS[name] ?? GLYPHS[name]));
  const svg = built.get(name).cloneNode(true);
  svg.setAttribute('class', cls);
  return svg;
}
