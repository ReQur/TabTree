// An abstract picture for the wallpaper mode: soft glows of violet, magenta, teal and amber on a dusk ground, with a
// few thin arcs. Drawn as SVG and rendered with @resvg/resvg-js from the repo's node_modules (read only).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO } from './prepare.js';

const require = createRequire(path.join(REPO, 'package.json'));
const { Resvg } = require('@resvg/resvg-js');

export const WALL_W = 2400;
export const WALL_H = 1400;

export function wallpaperSvg() {
  const glow = (cx, cy, r, color, o = 1) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="${o}"/>`;
  const arcs = Array.from({ length: 9 }, (_, i) => {
    const r = 520 + i * 70;
    return `<circle cx="1750" cy="1500" r="${r}" fill="none" stroke="#ffffff" stroke-opacity="${0.05 - i * 0.004}" stroke-width="2"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WALL_W}" height="${WALL_H}" viewBox="0 0 ${WALL_W} ${WALL_H}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#120e2a"/>
      <stop offset="0.55" stop-color="#23184d"/>
      <stop offset="1" stop-color="#0d1a2e"/>
    </linearGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="150"/></filter>
    <filter id="softer" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70"/></filter>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
  </defs>
  <rect width="${WALL_W}" height="${WALL_H}" fill="url(#ground)"/>
  <g filter="url(#soft)">
    ${glow(380, 1100, 420, '#6d3df0', 0.85)}
    ${glow(1150, 520, 700, '#d63f9a', 0.9)}
    ${glow(2080, 1000, 420, '#12a7a0', 0.75)}
    ${glow(1700, 1350, 300, '#ff9d5c', 0.55)}
    ${glow(200, 150, 260, '#3b2a9e', 0.7)}
  </g>
  <g filter="url(#softer)">
    ${glow(1000, 760, 190, '#f06bc0', 0.6)}
    ${glow(620, 380, 150, '#b07bff', 0.45)}
  </g>
  ${arcs}
  <rect width="${WALL_W}" height="${WALL_H}" filter="url(#grain)" opacity="0.045"/>
</svg>`;
}

export function makeWallpaper(file) {
  const png = new Resvg(wallpaperSvg(), { fitTo: { mode: 'original' } }).render().asPng();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
  return file;
}

// The brand's logo, as the repo has it.
export const logoSvg = () => fs.readFileSync(path.join(REPO, 'assets/icon.svg'), 'utf8');
