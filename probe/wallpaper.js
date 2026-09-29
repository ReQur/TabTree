// The wallpaper's colors, from a small RGBA sample of the picture (for example 64×36): the scrim's tone and the
// accent. Pure functions over pixel arrays, so that the tests can feed them made-up pixels.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = v => Math.round(v * 100) / 100;
const average = list => [0, 1, 2].map(k => list.reduce((sum, p) => sum + p[k], 0) / list.length);

// [r, g, b] 0–255 → [hue 0–360, saturation 0–1, lightness 0–1].
function toHsl([r, g, b]) {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const h = max === rr ? ((gg - bb) / d + 6) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [h * 60, d / (1 - Math.abs(2 * l - 1)), l];
}

function toRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return [r, g, b].map(v => Math.round((v + l - c / 2) * 255));
}

export const hex = color => `#${color.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const rgba = (color, alpha) => `rgba(${color.map(Math.round).join(', ')}, ${alpha})`;

function luminance(color) {
  const [r, g, b] = color.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The WCAG contrast ratio of two colors.
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The picture's tones: `vivid`, its most frequent color with enough saturation (null for a grey picture),
// `dark`, the average of its darkest tenth, and `mean`, the average of all of it. Pixels mostly transparent
// don't count.
export function tonesOf(data) {
  const pixels = [];
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] >= 128) pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (!pixels.length) return { vivid: null, dark: [12, 14, 34], mean: [128, 128, 128] };
  // Saturated pixels vote by hue, in 24 buckets of 15°; a bucket also gets half its neighbours' votes, so that
  // a color on a bucket's edge isn't split in two. Greys, near-blacks and near-whites don't vote.
  const buckets = Array.from({ length: 24 }, () => []);
  for (const p of pixels) {
    const [h, s, l] = toHsl(p);
    if (s >= 0.3 && l >= 0.2 && l <= 0.88) buckets[Math.floor(h / 15) % 24].push(p);
  }
  const votes = i => buckets[i].length + (buckets[(i + 23) % 24].length + buckets[(i + 1) % 24].length) / 2;
  let best = -1;
  for (let i = 0; i < 24; i++) {
    if (buckets[i].length && (best < 0 || votes(i) > votes(best))) best = i;
  }
  const vivid = best >= 0 && buckets[best].length >= pixels.length * 0.02 ? average(buckets[best]) : null;
  const byLight = [...pixels].sort((a, b) => luminance(a) - luminance(b));
  const whole = c => c.map(Math.round);
  return {
    vivid: vivid && whole(vivid),
    dark: whole(average(byLight.slice(0, Math.max(1, Math.round(pixels.length / 10))))),
    mean: whole(average(pixels)),
  };
}

// Moves a color's lightness away from the ground (up in the dark theme, down in the light one) until it reads
// at 4.5:1, or as far as it goes: with hardly any scrim over a mid-tone picture no color reaches that.
function readable([h, s, l], ground, step) {
  let color = toRgb([h, s, l]);
  for (let light = l; contrast(color, ground) < 4.5 && light > 0.02 && light < 0.98;) {
    light += step * 0.01;
    color = toRgb([h, s, light]);
  }
  return color;
}

// The custom properties of the wallpaper mode for one theme. Always the scrim: its color (the picture's darkest
// tone made very dark, or its average made near white) and its strength (`dim`, 0–1; a little stronger at the
// top, under the header). With `accent: 'wallpaper'` and a vivid color in the picture, also the accent tokens,
// with --accent-text readable on the scrim over the picture.
export function wallTokens(tones, { dark, dim, accent }) {
  const [dh, ds] = toHsl(dark ? tones.dark : tones.mean);
  const scrim = toRgb(dark ? [dh, Math.min(ds, 0.5), 0.09] : [dh, Math.min(ds, 0.45), 0.975]);
  const alpha = clamp(dark ? dim : dim + 0.08, 0, 1);
  const tokens = {
    '--scrim': scrim.join(' '),
    '--dim': round(alpha),
    '--dim-top': round(Math.min(1, alpha + 0.12)),
  };
  if (accent !== 'wallpaper' || !tones.vivid) return tokens;
  const ground = tones.mean.map((v, k) => v + (scrim[k] - v) * alpha);
  const [h, s] = toHsl(tones.vivid);
  const pale = toRgb([h, clamp(s * 1.1, 0.45, 0.85), 0.76]);
  if (dark) {
    return {
      ...tokens,
      '--accent': hex(pale),
      '--accent-fg': hex(toRgb([h, 0.5, 0.12])),
      '--accent-text': hex(readable([h, clamp(s * 1.2, 0.5, 0.9), 0.83], ground, 1)),
      '--sel': rgba(pale, 0.25),
      '--sel-hover': rgba(pale, 0.33),
    };
  }
  return {
    ...tokens,
    // White text sits on the accent (the primary button), so it has to read too.
    '--accent': hex(readable([h, clamp(s * 0.73, 0.35, 0.65), 0.49], [255, 255, 255], -1)),
    '--accent-fg': '#ffffff',
    '--accent-text': hex(readable([h, clamp(s * 0.84, 0.4, 0.7), 0.41], ground, -1)),
    '--sel': rgba(pale, 0.36),
    '--sel-hover': rgba(pale, 0.46),
  };
}
