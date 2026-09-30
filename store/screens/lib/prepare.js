// Copies the extension from the repo's probe/ into screens/ext/, with Chrome's manifest (manifestFor, from the
// repo's scripts/manifests.js) plus host permissions for the sample sites, so that the statuses watch counts them as
// connected without a permission prompt. Also adds helper.html, an extension page whose button opens the side panel
// (sidePanel.open needs a user gesture; a Puppeteer click is one). The repo is only read.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// store/screens/lib/ → the repo.
export const REPO = process.env.BRANCHY_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const SAMPLE_ORIGINS = ['http://jira.example.com/*', 'http://gitlab.example.com/*', 'http://ci.example.com/*'];

export async function prepareExtension(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(REPO, 'probe'), dir, { recursive: true });
  const { manifestFor } = await import(pathToFileURL(path.join(REPO, 'scripts/manifests.js')).href);
  const base = JSON.parse(fs.readFileSync(path.join(REPO, 'probe/manifest.json'), 'utf8'));
  const manifest = { ...manifestFor(base, 'chrome'), host_permissions: SAMPLE_ORIGINS };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dir, 'helper.html'), `<!doctype html><meta charset="utf-8"><title>helper</title>
<button id="open" style="font-size:40px">Open the side panel</button>
<script src="helper.js"></script>`);
  fs.writeFileSync(path.join(dir, 'helper.js'), `document.getElementById('open').onclick = async () => {
  const windowId = Number(new URLSearchParams(location.search).get('window'));
  try {
    await chrome.sidePanel.open({ windowId });
    document.title = 'opened';
  } catch (e) {
    document.title = 'failed: ' + e.message;
  }
};`);
  return manifest;
}
