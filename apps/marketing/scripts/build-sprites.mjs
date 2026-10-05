// Builds the map sprites from the REAL guest-app images (track 027 D8: graphics must be the app's,
// not made up). Source: apps/user/components/reservation/*.png — the exact files the guest booking
// map (SunbedSelection.tsx) layers. The originals are 0.5 MB each; these are sized for a canvas
// drawn at up to ~60 px per bed on a 2x screen.
//
//   node apps/marketing/scripts/build-sprites.mjs     (from the repo root; re-run if the app's images change)
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const src = new URL('../../user/components/reservation/', import.meta.url)
const out = new URL('../public/app/', import.meta.url)
const jobs = [
  ['sunbed-perforated-transparent.png', 'sunbed.webp', 128],
  ['sunshade-transparent.png', 'sunshade.webp', 192],
  ['beach-towel-transparent.png', 'towel.webp', 128],
]
for (const [from, to, width] of jobs) {
  const info = await sharp(fileURLToPath(new URL(from, src))).resize({ width }).webp({ quality: 88, alphaQuality: 100 }).toFile(fileURLToPath(new URL(to, out)))
  console.log(`${to}: ${info.width}x${info.height}, ${(info.size / 1024).toFixed(1)} KB`)
}
