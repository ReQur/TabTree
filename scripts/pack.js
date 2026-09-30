// `npm run pack`: what goes to the stores, from probe/ as it is. For each browser, dist/<browser>/ (to load unpacked
// and try) and dist/tabtree-<browser>-<version>.zip (to upload). Only the manifest differs (manifests.js). Needs
// the `zip` command.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TARGETS, manifestFor } from './manifests.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(repo, 'probe');
const dist = path.join(repo, 'dist');
const base = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));

fs.mkdirSync(dist, { recursive: true });
for (const target of TARGETS) {
  const dir = path.join(dist, target);
  const zip = path.join(dist, `tabtree-${target}-${base.version}.zip`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  fs.cpSync(source, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifestFor(base, target), null, 2)}\n`);
  // -X leaves out file attributes that differ between machines.
  execFileSync('zip', ['-r', '-X', '-q', zip, '.'], { cwd: dir });
  console.log(`${path.relative(repo, zip)}  (unpacked: ${path.relative(repo, dir)}/)`);
}
