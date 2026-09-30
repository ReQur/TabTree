// The panel in Chrome (probe/panel.js in jsdom, with Chrome's user agent and no `opr`): tab groups where Opera has
// islands, Chrome's setup steps, a window instead of workspaces, and Chrome in the report.
import { check, wait, done } from './helpers/check.js';
import { loadPanel } from './helpers/panel-env.js';

const tab = (id, title, url, extra = {}) => ({ id, index: id, windowId: 1, title, url, active: false, pinned: false, groupId: -1, favIconUrl: '', lastAccessed: 100, ...extra });
const p = await loadPanel({
  browser: 'chrome',
  tabs: [
    tab(1, 'Dashboard A', 'https://grafana.example.com/a', { groupId: 7 }),
    tab(2, 'Dashboard B', 'https://grafana.example.com/b', { groupId: 7 }),
    tab(3, 'Runbook', 'https://wiki.example.com/runbook'),
    tab(4, 'Loose', 'https://example.com/', { active: true, lastAccessed: 900 }),
  ],
  store: {
    folders: {
      rel: { name: 'Release', color: 'blue', parent: null, created: 1 },
      solo: { name: 'Solo', color: 'green', parent: null, created: 2 },
    },
    parents: { 1: 'f:rel', 2: 'f:rel', 3: 'f:solo' },
    ranks: {},
  },
});
const { $ } = p;
const all = sel => [...p.w.document.querySelectorAll(sel)];
const texts = sel => all(sel).map(e => e.textContent);
const count = name => p.row(name).querySelector('.count').title;

check(`the setup guide: «${$('.card p')?.textContent}»`, $('.card p')?.textContent === 'Two things in Chrome, once. Click a step to mark it done.');
check(`Chrome's steps: ${texts('.steps li b')}`, texts('.steps li b').join('|') === 'Pin TabTree|Put the side panel on the left');
check(`the status bar: «${$('#islands').textContent}», «${$('#islands').title}»`,
  $('#islands').textContent === 'Groups' && $('#islands').title === "1 folder is a tab group in Chrome's tab strip");
check(`folders: «${count('Release')}», «${count('Solo')}»`,
  count('Release') === "2 tabs · a tab group in Chrome's tab strip" && count('Solo') === '1 tab · no tab group: a folder needs two tabs for one');
check('no other workspaces', !$('#list .section') && !$('.badge.ws'));

$('#open-settings').click();
await wait(50);
check(`Settings: ${texts('.settings .sub')}`, texts('.settings .sub').join() === 'Background,Statuses,Tree,Chrome,Backup,Diagnostics,Setup');
const option = name => all('.opt').find(o => o.querySelector('b').textContent === name);
check('the mirror is called Tab groups', option('Tab groups')?.querySelector('p').textContent.startsWith("Every top-level folder with two or more tabs is a tab group in Chrome's tab strip."));
const groups = all('.islands .il').map(li => `${li.querySelector('.grow').textContent}: ${li.querySelector('.m').textContent}`);
check(`each top-level folder's group: ${groups.join('; ')}`, groups.join('; ') === 'Release: 2 tabs · tab group; Solo: 1 tab · no tab group, needs 2');
check('the setup guide, in short', option('Setup guide').querySelector('p').textContent === 'Pin TabTree to the toolbar, put the side panel on the left.');
option('Report').querySelector('button').click();
await wait(50);
check(`the report names Chrome: «${p.copied.at(-1)?.split('\n')[1]}»`, p.copied.at(-1)?.split('\n')[1] === '- Chrome 151.0.0.0, Chromium 151.0.0.0, ' + p.w.navigator.platform);
option('Log').querySelector('button').click();
await wait(50);
check(`so does the Log: ${texts('.kv dt')[0]}`, texts('.kv dt')[0] === 'Chrome');

$('#back').click();
p.search('nothing-like-this');
await wait(50);
check("no match: the hint doesn't speak of workspaces", !!$('.empty') && !$('.empty p').textContent.includes('workspace'));
done();
