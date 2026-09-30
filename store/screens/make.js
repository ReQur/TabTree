// Makes the Chrome Web Store images of Branchy from the real extension in Chrome for Testing:
//   node make.js                  capture every panel shot, compose the images, write index.html
//   node make.js --only=2,3       capture those shots again (the others' raw captures stay), then compose
//   node make.js --compose        compose from the raw captures only (layout and words: compose.js)
//   node make.js --log            also print the fake sites' requests and the panel's console
// The extension is copied from the repo's probe/ at every capture run, so a change there shows up here.
import fs from 'node:fs';
import path from 'node:path';
import { capture } from './capture.js';
import { compose, SHOTS } from './compose.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const onlyArg = args.find(a => a.startsWith('--only='));

if (!args.includes('--compose')) {
  await capture({ only: onlyArg ? onlyArg.slice(7).split(',').map(Number) : null, log: args.includes('--log') });
}
await compose();
writeSheet();

function writeSheet() {
  const figure = (src, caption, w, h) => `<figure><a href="${src}"><img src="${src}" width="${w}" height="${h}" alt=""></a><figcaption>${caption}</figcaption></figure>`;
  const plain = s => s.replace(/&nbsp;/g, ' ');
  const shots = SHOTS.map(s => figure(`../images/${s.out}.png`, `<b>store/images/${s.out}.png</b> · 1280×800<br>${plain(s.title)}`, 640, 400)).join('\n');
  const extras = [
    ['raw/2-statuses-card.png', 'the details card open in place'],
    ['raw/3-search-mr.png', 'search for "mr"'],
    ['raw/5-wallpaper-settings.png', 'Settings › Background with the picture'],
    ['raw/1-tree.png', 'the tree, as captured'],
  ].filter(([f]) => fs.existsSync(path.join(HERE, f)))
    .map(([f, what]) => figure(f, `<b>${f}</b><br>${what}`, 207, 376)).join('\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Branchy store images</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: dark; --bg: #121118; --fg: #ece9f7; --muted: #9d98b3; --line: #2a2735; --accent: #a48cff; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 16px 64px; background: var(--bg); color: var(--fg); font: 15px/1.5 "Segoe UI", system-ui, sans-serif; }
  main { max-width: 1340px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 26px; } h2 { margin: 44px 0 12px; font-size: 17px; color: var(--accent); }
  p, li { color: var(--muted); max-width: 900px; }
  .grid { display: flex; flex-wrap: wrap; gap: 24px; }
  figure { margin: 0; }
  figure img { display: block; max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 0 0 1px var(--line); background: #000; }
  figcaption { margin-top: 8px; font-size: 13px; color: var(--muted); } figcaption b { color: var(--fg); font-weight: 600; }
  code, pre { font: 13px/1.5 Consolas, "Cascadia Mono", monospace; }
  pre { padding: 14px 16px; border-radius: 8px; background: #1b1924; box-shadow: inset 0 0 0 1px var(--line); overflow-x: auto; }
</style></head>
<body><main>
<h1>Branchy: Chrome Web Store images</h1>
<p>Captured ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from the real extension (the repo's <code>probe/</code> with Chrome's manifest) in Chrome's real side panel, headless Chrome for Testing, with made-up sample data from local fake sites. The PNGs in <code>store/images/</code> are 24-bit (no alpha), as the store asks.</p>
<h2>Screenshots (1280×800)</h2>
<div class="grid">${shots}</div>
<h2>Small promo tile (440×280)</h2>
<div class="grid">${figure('../images/promo-440x280.png', '<b>store/images/promo-440x280.png</b> · 440×280', 440, 280)}</div>
<h2>Raw captures and alternates</h2>
<div class="grid">${extras}</div>
<h2>Making them again</h2>
<pre>cd ${HERE}
node make.js                # capture all shots, compose, rewrite this page (about 30 s)
node make.js --only=2,3     # capture shots 2 and 3 again, keep the other raw captures
node make.js --compose      # only the layout and words, from raw/ (seconds)</pre>
<ul>
  <li><code>lib/sample.js</code>: the tabs (titles, favicons, openers, folders) and what the fake Jira, GitLab and Jenkins answer.</li>
  <li><code>capture.js</code>: the panel's size and scale (<code>PANEL</code>), the search queries, the Settings section shown, the wallpaper's Dim and place, and each shot's steps.</li>
  <li><code>compose.js</code>: headlines and lines (<code>SHOTS</code>), the canvas, the callout, the promo tile.</li>
  <li><code>lib/server.js</code> the fake sites; <code>lib/browser.js</code> Chrome, the scene, the side panel; <code>lib/prepare.js</code> the extension copy in <code>ext/</code>; <code>lib/wallpaper.js</code> the abstract picture.</li>
  <li>Needs: <code>npm install</code> in the repo (for <code>@resvg/resvg-js</code>) and here (puppeteer, pngjs; Chrome for Testing goes to <code>~/.cache/puppeteer</code>), then <code>./setup.sh</code> once: it puts libgbm and libwayland-server into <code>libs/</code> (from Ubuntu's .deb files, no root) and Segoe UI and Consolas from Windows into <code>fonts/</code>. Neither goes into git.</li>
</ul>
</main></body></html>`;
  fs.writeFileSync(path.join(HERE, 'index.html'), html);
  console.log('index.html');
}
