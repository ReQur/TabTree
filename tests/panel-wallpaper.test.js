// Settings › Background (probe/panel.js in jsdom): a stored picture drawn behind the panel; Dim, Blur, the
// frame's position and the accent applied to the picture and the scrim and stored; None, Remove, and a change
// stored by another panel. jsdom has no dark theme, so the light one is drawn.
import { check, wait, done } from './helpers/check.js';
import { loadPanel } from './helpers/panel-env.js';
import { wallTokens } from '../probe/wallpaper.js';

const tab = (id, title, url, extra = {}) => ({ id, index: id, windowId: 1, title, url, active: false, pinned: false, groupId: -1, favIconUrl: '', lastAccessed: 100, workspaceId: 'w', ...extra });
// The tones of a made-up picture: a navy sky with a pink band.
const tones = { vivid: [225, 127, 186], dark: [20, 24, 64], mean: [119, 90, 131] };
const picture = {
  source: 'file', name: 'sky.jpg', dataUrl: `data:image/jpeg;base64,${'A'.repeat(64)}`, width: 2560, height: 1440, w: 2489, h: 1400,
  bytes: 626688, tones, x: 12, dim: 70, blur: 0, accent: 'wallpaper',
};
const p = await loadPanel({
  tabs: [tab(1, 'Home', 'https://example.com/', { active: true, lastAccessed: 900 })],
  store: { folders: {}, parents: {}, ranks: {}, settings: { onboarded: true }, wallpaper: structuredClone(picture) },
});
const { $, store } = p;
const body = p.w.document.body;
const wall = $('#wall');
const scrim = $('#scrim');
const prop = (e, name) => e.style.getPropertyValue(name);
const slide = async (id, value) => {
  $(id).value = String(value);
  $(id).dispatchEvent(new p.w.Event('input', { bubbles: true }));
  $(id).dispatchEvent(new p.w.Event('change', { bubbles: true }));
  await wait(20);
};
const pointer = (target, type, clientX) => target.dispatchEvent(new p.w.MouseEvent(type, { bubbles: true, cancelable: true, clientX }));

check('a stored picture is drawn behind the panel', body.classList.contains('wp') && !wall.hidden && wall.getAttribute('src') === picture.dataUrl && !scrim.hidden);
check(`at its place, dimmed, not blurred: x ${prop(wall, '--x')}, dim ${prop(scrim, '--dim')}`,
  prop(wall, '--x') === '12%' && prop(scrim, '--dim') === '0.78' && !wall.classList.contains('blur'));
const own = wallTokens(tones, { dark: false, dim: 0.7, accent: 'wallpaper' });
check(`with the accent of the picture: ${prop(body, '--accent')}`, prop(body, '--accent') === own['--accent'] && prop(body, '--sel') === own['--sel'] && prop(body, '--scrim') === own['--scrim']);

$('#open-settings').click();
const option = name => [...p.w.document.querySelectorAll('.opt')].find(o => o.querySelector('b').textContent === name);
option('Report').querySelector('button').click();
await wait(50);
const line = p.copied.at(-1)?.split('\n').find(l => l.startsWith('- Wallpaper:'));
check(`the report says what is drawn: «${line}»`, line === `- Wallpaper: image 2560×1440 → 2489×1400, 612 KB, x 12, dim 70, blur 0, accent ${own['--accent']}`);
check('Settings › Background comes first, with the picture chosen',
  $('.settings .sub').textContent === 'Background' && $('#wp-file').getAttribute('aria-checked') === 'true' && $('.wp-name span').textContent === 'sky.jpg · 2489×1400'
  && $('#wp-dim').value === '70' && $('#wp-blur').value === '0' && $('.acc.on')?.dataset.accent === 'wallpaper');

await slide('#wp-dim', 40);
check(`Dim sets the scrim's strength, and is stored: ${prop(scrim, '--dim')}`, prop(scrim, '--dim') === '0.48' && store.wallpaper.dim === 40 && $('#wp-dim').parentNode.querySelector('span').textContent === '40%');
await slide('#wp-blur', 8);
check(`Blur blurs the picture, and is stored: ${prop(wall, '--blur')}`, wall.classList.contains('blur') && prop(wall, '--blur') === '8px' && store.wallpaper.blur === 8);
check('the Settings view was not redrawn meanwhile: the sliders keep their place', $('#wp-dim').value === '40');

const slice = $('.slice');
slice.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 96 });
pointer(slice, 'pointerdown', 150);
check(`dragging the frame moves the picture at once: x ${prop(wall, '--x')}`, prop(wall, '--x') === '83%' && store.wallpaper.x === 12);
pointer(slice, 'pointermove', 190);
pointer(slice, 'pointerup', 190);
await wait(20);
check(`and stores the place when let go: x ${store.wallpaper.x}`, prop(wall, '--x') === '100%' && store.wallpaper.x === 100);
$('#wp-frame').dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
await wait(20);
check('← and → move it too', store.wallpaper.x === 95 && $('#wp-frame').getAttribute('aria-valuenow') === '95');

$('.acc[data-accent="blue"]').click();
await wait(20);
check('the Blue accent drops the picture\'s one', store.wallpaper.accent === 'blue' && prop(body, '--accent') === '' && prop(body, '--scrim') !== '' && $('.acc.on')?.dataset.accent === 'blue');

await globalThis.chrome.storage.local.set({ wallpaper: { ...store.wallpaper, dim: 20 } });
await wait(50);
check(`a change stored by another panel is followed: dim ${prop(scrim, '--dim')}`, prop(scrim, '--dim') === '0.28' && $('#wp-dim').value === '20');

$('#wp-none').click();
await wait(20);
check('None takes the picture away and keeps it for later', !body.classList.contains('wp') && wall.hidden && scrim.hidden && store.wallpaper.source === 'none'
  && store.wallpaper.dataUrl === picture.dataUrl && $('#wp-none').getAttribute('aria-checked') === 'true');
$('#wp-file').click();
await wait(20);
check('Image file brings it back', body.classList.contains('wp') && store.wallpaper.source === 'file' && !!$('.slice'));

[...p.w.document.querySelectorAll('.wp-name button')].find(b => b.textContent === 'Remove').click();
await wait(20);
check('Remove deletes it', !('wallpaper' in store) && !body.classList.contains('wp') && !wall.getAttribute('src') && prop(body, '--scrim') === '');
let picked = false;
$('#wp-input').click = () => {
  picked = true;
};
$('#wp-file').click();
check('with no picture, Image file opens the file picker', picked);
done();
