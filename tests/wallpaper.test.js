// The wallpaper's colors (probe/wallpaper.js): the tones of a picture and the tokens made from them, fed with
// made-up pixels.
import { check, done } from './helpers/check.js';
import { tonesOf, wallTokens, contrast } from '../probe/wallpaper.js';

// A 64×36 RGBA picture made of colors in the given shares.
function picture(parts) {
  const data = new Uint8ClampedArray(64 * 36 * 4);
  let at = 0;
  for (const [color, share, alpha = 255] of parts) {
    const end = Math.min(64 * 36, at + Math.round(share * 64 * 36));
    for (; at < end; at++) data.set([...color, alpha], at * 4);
  }
  return data;
}
const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function hueOf([r, g, b]) {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}
const lightness = c => (Math.max(...c) + Math.min(...c)) / 510;
// The ground text sits on: the scrim, at its strength, over the picture's average color.
const groundOf = (tones, tokens) => {
  const scrim = tokens['--scrim'].split(' ').map(Number);
  return tones.mean.map((v, k) => v + (scrim[k] - v) * tokens['--dim']);
};

const NAVY = [20, 24, 64];
const PINK = [225, 127, 186];
const CLOUD = [236, 236, 242];
const sky = tonesOf(picture([[NAVY, 0.5], [PINK, 0.3], [CLOUD, 0.15], [[255, 0, 0], 0.05, 0]]));
check(`the most frequent color with enough saturation: ${sky.vivid}`, sky.vivid.join() === PINK.join());
check(`the darkest tone: ${sky.dark}`, sky.dark.join() === NAVY.join());
check(`the average, without the transparent pixels: ${sky.mean}`, sky.mean.join() === [0, 1, 2].map(k => Math.round((NAVY[k] * 0.5 + PINK[k] * 0.3 + CLOUD[k] * 0.15) / 0.95)).join());

const dark = wallTokens(sky, { dark: true, dim: 0.7, accent: 'wallpaper' });
const pinkHue = hueOf(PINK);
check(`dark theme: an accent of the picture's hue, light enough to mark on the dark scrim: ${dark['--accent']}`,
  Math.abs(hueOf(rgbOf(dark['--accent'])) - pinkHue) < 6 && lightness(rgbOf(dark['--accent'])) > 0.7);
check(`its text reads at 4.5:1 on the scrimmed picture: ${contrast(rgbOf(dark['--accent-text']), groundOf(sky, dark)).toFixed(2)}`,
  contrast(rgbOf(dark['--accent-text']), groundOf(sky, dark)) >= 4.5);
check('and the selection is the accent, translucent', dark['--sel'] === `rgba(${rgbOf(dark['--accent']).join(', ')}, 0.25)`);
check(`the scrim is the picture's darkest tone made very dark: ${dark['--scrim']}`,
  Math.abs(hueOf(dark['--scrim'].split(' ').map(Number)) - hueOf(NAVY)) < 10 && lightness(dark['--scrim'].split(' ').map(Number)) < 0.12);
check('Dim is its strength, a little stronger under the header', dark['--dim'] === 0.7 && dark['--dim-top'] === 0.82);

const light = wallTokens(sky, { dark: false, dim: 0.7, accent: 'wallpaper' });
check(`light theme: a deeper accent that white text reads on: ${light['--accent']}`,
  Math.abs(hueOf(rgbOf(light['--accent'])) - pinkHue) < 6 && contrast(rgbOf(light['--accent']), [255, 255, 255]) >= 4.5);
check(`its text reads at 4.5:1 on the near-white scrim: ${contrast(rgbOf(light['--accent-text']), groundOf(sky, light)).toFixed(2)}`,
  contrast(rgbOf(light['--accent-text']), groundOf(sky, light)) >= 4.5 && lightness(light['--scrim'].split(' ').map(Number)) > 0.95);

const dusk = tonesOf(picture([[[150, 120, 140], 0.7], [[200, 90, 150], 0.3]]));
const thin = wallTokens(dusk, { dark: true, dim: 0.3, accent: 'wallpaper' });
check(`a thin scrim over a bright picture: the accent's text goes lighter until it reads: ${thin['--accent-text']}`,
  contrast(rgbOf(thin['--accent-text']), groundOf(dusk, thin)) >= 4.5 && lightness(rgbOf(thin['--accent-text'])) > 0.83);

const grey = tonesOf(picture([[[40, 40, 40], 0.5], [[200, 200, 200], 0.5]]));
check('a grey picture has no color of its own, and keeps the violet accent',
  grey.vivid === null && !('--accent' in wallTokens(grey, { dark: true, dim: 0.7, accent: 'wallpaper' })));
check('with the Violet accent only the scrim changes', Object.keys(wallTokens(sky, { dark: true, dim: 0.7, accent: 'violet' })).join() === '--scrim,--dim,--dim-top');
done();
