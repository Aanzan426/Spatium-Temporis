/**
 * Generate the Android icons from `public/logo-icon.svg`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The launcher icon is not the favicon and not the in-app logo: Android reads
 * `ic_launcher.png` out of the `mipmap-<density>` folders. Until those files exist the
 * APK ships Capacitor's stock robot — which is why the logo was "not visible on the
 * APK" even after the SVGs landed in `public/`. Same story for the notification small
 * icon: `capacitor.config.ts` names `ic_stat_spatium`, and a missing drawable means
 * the notification falls back to a generic icon.
 *
 * Generated files are never hand-edited (§11): edit `public/logo-icon.svg`, re-run
 * this, commit the PNGs. `@capacitor/assets` was considered and skipped — it wants a
 * 1024px master and rewrites the whole asset set; this app already has its master in
 * `public/`, and one SVG in is worth a dozen flags.
 *
 * USAGE
 * -----
 *   npm run icons            # after `npx cap add android` has created android/
 *   npm run icons -- --force # regenerate even when the PNGs are newer than the SVG
 *
 * The PNGs are committed (docs/ANDROID.md already assumes a committed `android/`), so
 * this only has to run again when the logo actually changes.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const root = process.cwd()
const svg = readFileSync(join(root, 'public', 'logo-icon.svg'), 'utf8')
const res = join(root, 'android', 'app', 'src', 'main', 'res')
const force = process.argv.includes('--force')

/** `ic_launcher_background` — the palette's near-black, so the glow reads. */
const LAUNCHER_BG = '#0a0c10'

/**
 * Adaptive foreground: the tree mark inset to 85% so it stays inside Android's
 * adaptive-icon safe zone (the inner 66/108 circle that every launcher mask keeps).
 */
const DENSITIES = new Map<string, number>([
  ['mipmap-mdpi', 108],
  ['mipmap-hdpi', 162],
  ['mipmap-xhdpi', 216],
  ['mipmap-xxhdpi', 324],
  ['mipmap-xxxhdpi', 432],
])

/** Notification small icon — an alpha mask, so no color and no glow (gray mush at 24dp). */
const STAT_SIZES = [
  { out: 'drawable-mdpi/ic_stat_spatium.png', size: 24 },
  { out: 'drawable-hdpi/ic_stat_spatium.png', size: 36 },
  { out: 'drawable-xhdpi/ic_stat_spatium.png', size: 48 },
  { out: 'drawable-xxhdpi/ic_stat_spatium.png', size: 72 },
  { out: 'drawable-xxxhdpi/ic_stat_spatium.png', size: 96 },
]

/** One full-bleed dark tile with the mark centered; Capacitor scales it. */
const SPLASH = [{ out: 'drawable/splash.png', size: 1024 }]

if (!existsSync(res)) {
  console.error('android/app/src/main/res does not exist yet — run `npx cap add android` first.')
  process.exit(1)
}

/** If every output is newer than the SVG, there is nothing to do. */
const svgMtime = statSync(join(root, 'public', 'logo-icon.svg')).mtimeMs
const outputPaths = [
  ...[...DENSITIES.keys()].flatMap((dir) => [
    `${dir}/ic_launcher.png`,
    `${dir}/ic_launcher_round.png`,
    `${dir}/ic_launcher_foreground.png`,
  ]),
  ...STAT_SIZES.map((s) => s.out),
  ...SPLASH.map((s) => s.out),
]
if (
  !force &&
  outputPaths.every((p) => existsSync(join(res, p)) && statSync(join(res, p)).mtimeMs > svgMtime)
) {
  console.log('icons up to date (pass --force to regenerate)')
  process.exit(0)
}

/** Rasterize an SVG source at exactly `size` × `size`. */
function render(source: string, size: number): Buffer {
  const resvg = new Resvg(source, { fitTo: { mode: 'width', value: size } })
  return resvg.render().asPng()
}

/** The logo's inner content, so it can be embedded with a new size/transform. */
function innerMark(): string {
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
}

// --- launcher icons -------------------------------------------------------------

for (const [dir, size] of DENSITIES) {
  const out = join(res, dir)
  mkdirSync(out, { recursive: true })

  // Foreground only: the mark at 85%, on transparent. The adaptive background color
  // supplies the tile. The glow is part of the mark and scales with it.
  const fg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <g transform="translate(${size * 0.075} ${size * 0.075}) scale(${size * 0.85 / 100})">${innerMark()}</g>
  </svg>`
  writeFileSync(join(out, 'ic_launcher_foreground.png'), render(fg, size))

  // Round + square legacy icons for launchers that skip the adaptive path: a solid
  // dark tile behind the mark, drawn here so the SVG itself stays background-free.
  const tile = size / 3
  const legacy = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${tile}" fill="${LAUNCHER_BG}"/>
    <g transform="translate(${size * 0.2} ${size * 0.2}) scale(${size * 0.6 / 100})">${innerMark()}</g>
  </svg>`
  writeFileSync(join(out, 'ic_launcher.png'), render(legacy, size))
  writeFileSync(join(out, 'ic_launcher_round.png'), render(legacy, size))
}

// Adaptive icon wiring: generated once, left alone if hand-tuned later.
const adaptiveDir = join(res, 'mipmap-anydpi-v26')
mkdirSync(adaptiveDir, { recursive: true })
for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  const path = join(adaptiveDir, name)
  if (!existsSync(path)) {
    writeFileSync(
      path,
      `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`,
    )
  }
}
const valuesDir = join(res, 'values')
mkdirSync(valuesDir, { recursive: true })
const colorsPath = join(valuesDir, 'ic_launcher_background.xml')
if (!existsSync(colorsPath)) {
  writeFileSync(colorsPath, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${LAUNCHER_BG}</color>
</resources>
`)
}

// --- notification small icon: white-on-transparent silhouette -------------------

// `capacitor.config.ts` names `ic_stat_spatium`. The small icon is rendered as a pure
// alpha mask (color comes from the notification), and the logo's glow effects render
// as gray mush at 24dp — so the silhouette is drawn by hand in the same tree shape.
const silhouette = (size: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g fill="#ffffff">
    <path d="M ${size * 0.5} ${size * 0.88} L ${size * 0.5} ${size * 0.42}" stroke="#ffffff" stroke-width="${size * 0.05}"/>
    <circle cx="${size / 2}" cy="${size * 0.52}" r="${size * 0.09}"/>
    <path d="M ${size * 0.5} ${size * 0.44} Q ${size * 0.34} ${size * 0.32} ${size * 0.24} ${size * 0.2} L ${size * 0.28} ${size * 0.2} Q ${size * 0.4} ${size * 0.32} ${size * 0.5} ${size * 0.4} Z"/>
    <path d="M ${size * 0.5} ${size * 0.44} Q ${size * 0.66} ${size * 0.32} ${size * 0.76} ${size * 0.2} L ${size * 0.72} ${size * 0.2} Q ${size * 0.6} ${size * 0.32} ${size * 0.5} ${size * 0.4} Z"/>
    <circle cx="${size * 0.24}" cy="${size * 0.18}" r="${size * 0.04}"/>
    <circle cx="${size * 0.76}" cy="${size * 0.18}" r="${size * 0.04}"/>
    <circle cx="${size * 0.5}" cy="${size * 0.13}" r="${size * 0.05}"/>
  </g>
</svg>`

for (const { out, size } of STAT_SIZES) {
  const path = join(res, out)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, render(silhouette(size), size))
}

// --- splash ---------------------------------------------------------------------

for (const { out, size } of SPLASH) {
  const path = join(res, out)
  mkdirSync(dirname(path), { recursive: true })
  const splashSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${LAUNCHER_BG}"/>
    <g transform="translate(${size * 0.3} ${size * 0.3}) scale(${size * 0.4 / 100})">${innerMark()}</g>
  </svg>`
  writeFileSync(path, render(splashSvg, size))
}

console.log(`icons written under ${relative(root, res)}:`)
for (const p of outputPaths) console.log('  ' + p)
