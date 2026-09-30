// Which browser the panel runs in and the words it uses there (probe/browser.js), and the manifest each browser gets
// in the store packages (scripts/manifests.js).
import fs from 'node:fs';
import { check, done } from './helpers/check.js';
import { browserOf } from '../probe/browser.js';
import { TARGETS, manifestFor } from '../scripts/manifests.js';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const OPERA = `${CHROME} OPR/135.0.0.0`;
const EDGE = `${CHROME} Edg/151.0.0.0`;
const version = ua => ua.match(browserOf(ua).version)?.[1];

check('Opera by its opr object, whatever the user agent says', browserOf(CHROME, {}).id === 'opera');
check(`Opera, Edge and Chrome by their user agents: ${[OPERA, EDGE, CHROME].map(ua => `${browserOf(ua).name} ${version(ua)}`)}`,
  browserOf(OPERA).id === 'opera' && browserOf(EDGE).id === 'edge' && browserOf(CHROME).id === 'chrome'
  && version(OPERA) === '135.0.0.0' && version(EDGE) === '151.0.0.0' && version(CHROME) === '151.0.0.0');
check('Opera has islands and workspaces; Chrome and Edge have tab groups',
  browserOf(OPERA).group === 'island' && browserOf(OPERA).workspaces
  && [CHROME, EDGE].every(ua => browserOf(ua).group === 'tab group' && browserOf(ua).short === 'Groups' && !browserOf(ua).workspaces));
const steps = ua => browserOf(ua).setup.map(([id]) => id).join();
check(`setup steps: Opera ${steps(OPERA)}; Chrome ${steps(CHROME)}; Edge ${steps(EDGE)}`,
  steps(OPERA) === 'pin,tabs,islands' && steps(CHROME) === 'pin,left' && steps(EDGE) === 'pin,tabs');

const base = JSON.parse(fs.readFileSync(new URL('../probe/manifest.json', import.meta.url), 'utf8'));
const chrome = manifestFor(base, 'chrome');
check('Opera gets probe/manifest.json as it is', manifestFor(base, 'opera') === base);
check("Chrome: a side panel that the toolbar button opens, instead of Opera's sidebar",
  !('sidebar_action' in chrome) && chrome.side_panel.default_path === 'panel.html' && chrome.permissions.includes('sidePanel')
  && chrome.action.default_title === base.sidebar_action.default_title && chrome.minimum_chrome_version === '116');
check('everything else stays',
  chrome.version === base.version && chrome.name === base.name && base.permissions.every(p => chrome.permissions.includes(p))
  && JSON.stringify(chrome.optional_host_permissions) === JSON.stringify(base.optional_host_permissions)
  && JSON.stringify(chrome.background) === JSON.stringify(base.background) && JSON.stringify(chrome.icons) === JSON.stringify(base.icons));
check('Edge gets what Chrome gets', JSON.stringify(manifestFor(base, 'edge')) === JSON.stringify(chrome));
check("Opera's manifest isn't touched", 'sidebar_action' in base && !base.permissions.includes('sidePanel'));
const named = m => [m.background.service_worker, m.side_panel?.default_path ?? m.sidebar_action.default_panel, ...Object.values(m.icons),
  ...Object.values((m.action ?? m.sidebar_action).default_icon)];
check('every file a manifest names is in probe/',
  TARGETS.every(t => named(manifestFor(base, t)).every(f => fs.existsSync(new URL(`../probe/${f}`, import.meta.url)))));
done();
