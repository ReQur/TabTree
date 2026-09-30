// Composes the store images from the raw panel captures: five 1280×800 screenshots and the 440×280 promo tile, as
// 24-bit PNGs (no alpha, as the Chrome Web Store asks) in store/images/. Each is an HTML page in compose/, rendered by
// Chrome at 1:1, so the panel captures are shown pixel for pixel.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { PNG } from 'pngjs';
import { logoSvg } from './lib/wallpaper.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const RAW = path.join(HERE, 'raw');
const OUT = path.join(HERE, '../images');
const PAGES = path.join(HERE, 'compose');

// The words of each screenshot. `raw`: the panel capture; `theme`: the canvas (dark, light, or the wallpaper).
export const SHOTS = [
  {
    out: '1-tree', raw: '1-tree.png', theme: 'dark', eyebrow: 'Tree',
    title: 'Your tabs, as&nbsp;a&nbsp;tree',
    text: 'A tab hangs under the tab that opened it. Tickets gather their merge requests and pipelines, and folders nest.',
  },
  {
    out: '2-statuses', raw: '2-statuses.png', card: '2-card.png', theme: 'dark', eyebrow: 'Statuses',
    title: 'Statuses at a&nbsp;glance',
    text: 'Jira statuses, approvals, pipelines and builds, read with your own sign-in. Nothing leaves the browser.',
  },
  {
    out: '3-search', raw: '3-search.png', theme: 'dark', eyebrow: 'Search',
    title: 'Any tab, one keystroke&nbsp;away',
    text: 'Press / and type a title, a ticket, a page kind or a status. Each result shows its place in the tree.',
    tries: ['PROJ-140', 'mr', 'failed', 'running'],
  },
  {
    out: '4-tab-groups', raw: '4-settings.png', theme: 'light', eyebrow: 'Tab groups',
    title: 'Folders become tab&nbsp;groups',
    text: 'Top-level folders are mirrored as Chrome tab groups. Back the tree up to a file and take it with you.',
  },
  {
    out: '5-wallpaper', raw: '5-wallpaper.png', theme: 'wall', eyebrow: 'Themes',
    title: 'Your picture behind the&nbsp;tree',
    text: 'Light or dark, as the browser is. Or a picture of yours, with the accent taken from its colors.',
  },
];

const url = file => `file://${file}`;
const logo = () => `data:image/svg+xml;base64,${Buffer.from(logoSvg()).toString('base64')}`;

function page(shot, meta) {
  const panel = meta.panel;
  const w = Math.round(panel.width * panel.scale);
  const h = Math.round(panel.height * panel.scale);
  const right = 76;
  const top = Math.round((800 - h) / 2);
  const left = 1280 - right - w;
  let callout = '';
  if (shot.card) {
    // The card beside the panel, joined to the row it belongs to by a line and a ring around the row.
    const rects = meta.shots['2-statuses-card'];
    const row = rects.row;
    const ry = top + row.y * panel.scale;
    const rh = row.height * panel.scale;
    const cardFile = path.join(RAW, shot.card);
    const { width: cw, height: ch } = PNG.sync.read(fs.readFileSync(cardFile));
    // Under the words, in their column; the line runs to the row across the gap.
    const cx = 88;
    const cy = 318;
    callout = `
      <div class="ring" style="left:${left + 3}px;top:${ry - 2}px;width:${w - 6}px;height:${rh + 4}px"></div>
      <svg class="link" width="1280" height="800"><path d="M${cx + cw} ${cy + 34} C${cx + cw + 26} ${cy + 34}, ${left - 26} ${ry + rh / 2}, ${left + 3} ${ry + rh / 2}" /><circle cx="${cx + cw}" cy="${cy + 34}" r="4" /></svg>
      <img class="card" src="${url(cardFile)}" style="left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px">`;
  }
  const textTop = shot.card ? 'top: 118px' : 'top: 0; bottom: 0; justify-content: center';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${shot.out}</title>
<style>
  :root { --font: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1280px; height: 800px; overflow: hidden; }
  body { position: relative; font-family: var(--font); -webkit-font-smoothing: antialiased; }
  body.dark { --ink: #f4f2ff; --muted: #b4b0c8; --eyebrow: #b8a6ff; --edge: rgba(255,255,255,.10);
    background: radial-gradient(760px 620px at 80% 48%, rgba(106,69,230,.34), transparent 70%),
      radial-gradient(640px 520px at 2% 108%, rgba(21,148,90,.20), transparent 70%),
      radial-gradient(520px 420px at 26% -12%, rgba(164,140,255,.10), transparent 70%), #0e0d15; }
  body.light { --ink: #17131f; --muted: #555068; --eyebrow: #5a37d4; --edge: rgba(24,16,48,.10);
    background: radial-gradient(760px 620px at 80% 48%, rgba(106,69,230,.16), transparent 70%),
      radial-gradient(640px 520px at 2% 108%, rgba(79,219,138,.20), transparent 70%), #f5f3fa; }
  body.wall { --ink: #fbf9ff; --muted: #d4cfe6; --eyebrow: #e4d9ff; --edge: rgba(255,255,255,.16);
    background: #120e2a url("${url(path.join(RAW, 'wallpaper.png'))}") center / cover; }
  body.wall::before { content: ""; position: absolute; inset: 0;
    background: linear-gradient(90deg, rgba(10,7,24,.80) 0%, rgba(10,7,24,.62) 48%, rgba(10,7,24,.30) 100%); }
  .brand { position: absolute; left: 88px; top: 56px; display: flex; align-items: center; gap: 12px;
    font: 600 21px/1 var(--font); color: var(--ink); letter-spacing: -.01em; }
  .brand img { width: 44px; height: 44px; margin: -4px; }
  .copy { position: absolute; left: 88px; width: 520px; display: flex; flex-direction: column; ${textTop}; }
  .eyebrow { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; font: 700 13px/1 var(--font);
    letter-spacing: .14em; text-transform: uppercase; color: var(--eyebrow); }
  .eyebrow::before { content: ""; width: 22px; height: 2px; border-radius: 2px; background: currentColor; }
  h1 { font: 650 54px/1.06 var(--font); letter-spacing: -.025em; color: var(--ink); text-wrap: balance; }
  p { margin-top: 20px; max-width: 470px; font: 400 20px/1.5 var(--font); color: var(--muted); text-wrap: pretty; }
  .tries { display: flex; align-items: center; gap: 10px; margin-top: 28px; font: 500 15px/1 var(--font); color: var(--muted); }
  .tries span { margin-right: 4px; }
  .tries kbd { padding: 8px 12px; border-radius: 8px; font: 500 15px/1 "Cascadia Mono", Consolas, monospace; color: var(--ink);
    background: rgba(255,255,255,.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12), 0 1px 0 rgba(255,255,255,.06); }
  .panel { position: absolute; left: ${left}px; top: ${top}px; width: ${w}px; height: ${h}px; border-radius: 14px;
    overflow: hidden; box-shadow: 0 0 0 1px var(--edge), 0 44px 90px -24px rgba(0,0,0,.62), 0 0 140px rgba(106,69,230,.22); }
  body.light .panel { box-shadow: 0 0 0 1px var(--edge), 0 40px 80px -28px rgba(46,30,110,.34), 0 0 120px rgba(106,69,230,.10); }
  .panel img { display: block; width: ${w}px; height: ${h}px; }
  .card { position: absolute; border-radius: 10px; box-shadow: 0 0 0 1px rgba(255,255,255,.12), 0 36px 80px -18px rgba(0,0,0,.7), 0 0 90px rgba(106,69,230,.28); }
  .ring { position: absolute; border-radius: 8px; box-shadow: 0 0 0 1.5px #a48cff, 0 0 18px rgba(164,140,255,.45); }
  .link { position: absolute; left: 0; top: 0; overflow: visible; }
  .link path { fill: none; stroke: #a48cff; stroke-width: 1.5; stroke-dasharray: 4 4; }
  .link circle { fill: #a48cff; }
</style></head>
<body class="${shot.theme}">
  <div class="brand"><img src="${logo()}" alt="">Branchy</div>
  <div class="copy">
    <div class="eyebrow">${shot.eyebrow}</div>
    <h1>${shot.title}</h1>
    <p>${shot.text}</p>
    ${shot.tries ? `<div class="tries"><span>Try</span>${shot.tries.map(t => `<kbd>${t}</kbd>`).join('')}</div>` : ''}
  </div>
  <div class="panel"><img src="${url(path.join(RAW, shot.raw))}" alt=""></div>
  ${callout}
</body></html>`;
}

function promo() {
  // Rows of a tree, abstract, in the folder colors: the right half of the tile.
  const rows = [
    [0, '#c58af9', 150, true], [1, '#ff8bcb', 118], [2, null, 132], [2, null, 96], [1, '#b8a6ff', 140], [2, null, 110], [3, null, 88],
    [0, '#78d9ec', 120, true], [1, null, 104],
  ];
  const at = (d, i) => ({ x: 246 + d * 22, y: 30 + i * 26 });
  const bars = rows.map(([d, c, wd, head], i) => {
    const { x, y } = at(d, i);
    const dot = `<rect x="${x}" y="${y}" width="12" height="12" rx="3" fill="${c ?? '#ffffff'}" opacity="${c ? 1 : 0.28}"/>`;
    return `${dot}<rect x="${x + 18}" y="${y + 2}" width="${wd}" height="8" rx="4" fill="#ffffff" opacity="${head ? 0.5 : 0.22}"/>`;
  }).join('');
  // A guide from each row's parent (the nearest row above, one level up) down and across to the row.
  const guides = rows.map(([d], i) => {
    if (!d) return '';
    let p = i - 1;
    while (p >= 0 && rows[p][0] !== d - 1) p--;
    const from = at(d - 1, p);
    const to = at(d, i);
    return `M${from.x + 6} ${from.y + 15} V${to.y + 6} H${to.x - 4}`;
  }).join(' ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>promo</title>
<style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 440px; height: 280px; overflow: hidden; }
  body { position: relative; font-family: "Segoe UI Variable", "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased;
    background: radial-gradient(300px 260px at 88% 30%, rgba(164,140,255,.42), transparent 70%),
      radial-gradient(260px 220px at 0% 110%, rgba(79,219,138,.30), transparent 70%), linear-gradient(135deg, #1c1640, #0f0d1c); }
  svg.tree { position: absolute; left: 0; top: 0; }
  .words { position: absolute; left: 30px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; }
  img { width: 76px; height: 76px; margin: -9px 0 6px -9px; }
  h1 { font: 700 40px/1 "Segoe UI Variable", "Segoe UI", sans-serif; letter-spacing: -.02em; color: #fff; }
  p { margin-top: 10px; width: 210px; font: 500 16px/1.35 "Segoe UI Variable", "Segoe UI", sans-serif; color: #d8d2f0; }
</style></head><body>
  <svg class="tree" width="440" height="280">
    <path d="${guides}" stroke="#ffffff" stroke-opacity=".2" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    ${bars}
  </svg>
  <div class="words"><img src="${logo()}" alt=""><h1>Branchy</h1><p>Tree style tabs,<br>grouped by ticket</p></div>
</body></html>`;
}

// The store wants 24-bit PNGs: the alpha channel goes.
function writeRgb(file, png) {
  const img = PNG.sync.read(png);
  fs.writeFileSync(file, PNG.sync.write(img, { colorType: 2, inputHasAlpha: true, bgColor: { red: 0, green: 0, blue: 0 } }));
}

export async function compose() {
  const meta = JSON.parse(fs.readFileSync(path.join(RAW, 'meta.json'), 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PAGES, { recursive: true });
  const env = { ...process.env };
  const libs = path.join(HERE, 'libs/root/usr/lib/x86_64-linux-gnu');
  if (fs.existsSync(libs)) env.LD_LIBRARY_PATH = libs;
  if (fs.existsSync(path.join(HERE, 'fonts/fonts.conf'))) env.FONTCONFIG_FILE = path.join(HERE, 'fonts/fonts.conf');
  const browser = await puppeteer.launch({ headless: true, env, args: ['--allow-file-access-from-files'] });
  try {
    const tab = await browser.newPage();
    const render = async (name, html, width, height) => {
      const file = path.join(PAGES, `${name}.html`);
      fs.writeFileSync(file, html);
      await tab.setViewport({ width, height, deviceScaleFactor: 1 });
      await tab.goto(url(file), { waitUntil: 'load' });
      await tab.evaluate(() => document.fonts.ready);
      const png = await tab.screenshot({ type: 'png' });
      writeRgb(path.join(OUT, `${name}.png`), png);
      console.log(`store/images/${name}.png`);
    };
    for (const shot of SHOTS) await render(shot.out, page(shot, meta), 1280, 800);
    await render('promo-440x280', promo(), 440, 280);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) await compose();
