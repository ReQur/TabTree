// `npm run icons`: probe/icons/<size>.png from assets/icon.svg. The 128 px icon keeps the stores' margin around
// the tile; the small ones, for the toolbar and Opera's sidebar, show the tile nearly edge to edge.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(repo, 'assets/icon.svg'), 'utf8');
const BOXES = { 16: '14 14 100 100', 32: '14 14 100 100', 48: '14 14 100 100', 128: '0 0 128 128' };

for (const [size, box] of Object.entries(BOXES)) {
  const svg = source.replace(/viewBox="[^"]*"/, `viewBox="${box}"`);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: Number(size) } }).render().asPng();
  fs.writeFileSync(path.join(repo, 'probe/icons', `${size}.png`), png);
  console.log(`probe/icons/${size}.png`);
}
