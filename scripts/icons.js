// `npm run icons`: probe/icons/<size>.png from assets/icon.svg. The 128 px icon keeps the stores' margin around
// the tile; the small ones, for the toolbar and Opera's sidebar, show the tile nearly edge to edge. Also the 300 px
// logo that Edge's store listing asks for, in store/images/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(repo, 'assets/icon.svg'), 'utf8');
const FILES = [
  ['probe/icons/16.png', 16, '14 14 100 100'],
  ['probe/icons/32.png', 32, '14 14 100 100'],
  ['probe/icons/48.png', 48, '14 14 100 100'],
  ['probe/icons/128.png', 128, '0 0 128 128'],
  ['store/images/logo-300.png', 300, '8 8 112 112'],
];

for (const [file, size, box] of FILES) {
  const svg = source.replace(/viewBox="[^"]*"/, `viewBox="${box}"`);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(path.join(repo, file), png);
  console.log(file);
}
