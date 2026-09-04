#!/usr/bin/env node
/**
 * Fill the empty image slots with licensed stock photography.
 *
 *   PEXELS_API_KEY=... node scripts/fetch-stock.mjs [slot ...]
 *
 * Uses the Pexels API, whose licence permits commercial use without a fee.
 * Each slot's `brief` in src/lib/images.ts is the search query, so what gets
 * downloaded is governed by the manifest rather than by anything hard-coded
 * here. Downloads land in public/images/ and the paths plus photographer
 * credits are written to src/lib/images.generated.json.
 *
 * NOTE: written but never executed — the sandbox this was built in blocks
 * outbound access to image hosts. Run it somewhere with network access and
 * check the first result before trusting the rest.
 *
 * Before you run it, two rules that no script can enforce:
 *   1. Never put a real patient in these slots. A patient photograph is health
 *      information under RA 10173, and consent for treatment is not consent to
 *      appear in marketing.
 *   2. Stock models are strangers, not your patients. Say so if a caption
 *      could imply otherwise, and prefer the clinic's own rooms and staff
 *      (with their written permission) wherever you can get them.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(root, 'public', 'images');
const MANIFEST = path.join(root, 'src', 'lib', 'images.generated.json');
const API_KEY = process.env.PEXELS_API_KEY;

if (!API_KEY) {
  console.error('Set PEXELS_API_KEY (free at https://www.pexels.com/api/).');
  process.exit(1);
}

// Parsed out of the TypeScript manifest so there is one source of truth for
// the briefs, without pulling a TS loader into a plain script.
const source = readFileSync(path.join(root, 'src', 'lib', 'images.ts'), 'utf8');
const slots = [...source.matchAll(
  /['"]?([a-z0-9-]+)['"]?:\s*\{[^}]*?ratio:\s*\[(\d+),\s*(\d+)\][^}]*?brief:\s*'([^']+)'/gs,
)].map(([, key, w, h, brief]) => ({ key, ratio: Number(w) / Number(h), brief }));

const wanted = process.argv.slice(2);
const targets = wanted.length ? slots.filter((s) => wanted.includes(s.key)) : slots;
if (targets.length === 0) {
  console.error(`No matching slots. Known: ${slots.map((s) => s.key).join(', ')}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
let manifest = {};
try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { /* first run */ }

for (const slot of targets) {
  const url = `https://api.pexels.com/v1/search?per_page=8&orientation=landscape&query=${encodeURIComponent(slot.brief)}`;
  const res = await fetch(url, { headers: { Authorization: API_KEY } });
  if (!res.ok) {
    console.error(`  ${slot.key}: search failed (${res.status})`);
    continue;
  }
  const { photos = [] } = await res.json();

  // Prefer the result whose aspect ratio is closest to the slot's, so the
  // object-cover crop throws away as little of the subject as possible.
  const best = photos
    .map((p) => ({ p, delta: Math.abs(p.width / p.height - slot.ratio) }))
    .sort((a, b) => a.delta - b.delta)[0]?.p;

  if (!best) {
    console.error(`  ${slot.key}: no results for "${slot.brief}"`);
    continue;
  }

  const image = await fetch(best.src.large2x);
  if (!image.ok) {
    console.error(`  ${slot.key}: download failed (${image.status})`);
    continue;
  }
  const file = `${slot.key}.jpg`;
  writeFileSync(path.join(OUT_DIR, file), Buffer.from(await image.arrayBuffer()));

  manifest[slot.key] = {
    src: `/images/${file}`,
    credit: { name: best.photographer, url: best.url, source: 'Pexels' },
  };
  console.log(`  ${slot.key.padEnd(12)} ${best.photographer} — ${best.url}`);
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nWrote ${Object.keys(manifest).length} slot(s) to src/lib/images.generated.json.`);
console.log('Review every image before shipping: a search result is not an editorial decision.');
