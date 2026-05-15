#!/usr/bin/env node
// Re-compress runtime GLBs in place using gltf-transform's `optimize` pass:
// Draco for geometry + WebP for textures + the standard prune/sparse passes.
// Typical results on this project: 92%+ file-size reduction (13MB → 1.1MB
// for hero_boombox), no visible quality loss.
//
// Usage:
//   npm run compress              # all whitelisted GLBs
//   npm run compress hero_table   # one specific GLB (matched by basename)
//
// The list is hard-coded to match `.gitignore`'s whitelist — when you add a
// new hero, add its file to BOTH places.

import { execSync } from 'node:child_process';
import { statSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const TARGETS = [
  'public/scene/shared.glb',
  'public/heroes/hero_boombox.glb',
  'public/heroes/hero_cassette_case.glb',
  'public/heroes/hero_cassette_raw_a.glb',
  'public/heroes/hero_cassette_raw_b.glb',
  'public/heroes/hero_chair.glb',
  'public/heroes/hero_table.glb',
];

const filter = process.argv[2];
const selected = filter
  ? TARGETS.filter((p) => basename(p, '.glb').includes(filter))
  : TARGETS;

if (selected.length === 0) {
  console.error(`No targets match "${filter}". Available:\n  ` + TARGETS.map(t => basename(t, '.glb')).join('\n  '));
  process.exit(1);
}

const fmt = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';

console.log(`Compressing ${selected.length} GLB${selected.length === 1 ? '' : 's'}…\n`);

let totalBefore = 0;
let totalAfter = 0;

// gltf-transform writes the output before deleting the input; for an in-place
// operation we route through a temp dir then copy back, so a failed run never
// corrupts the source.
const tmp = mkdtempSync(join(tmpdir(), 'lec-compress-'));

try {
  for (const target of selected) {
    const beforeBytes = statSync(target).size;
    totalBefore += beforeBytes;

    const tmpOut = join(tmp, basename(target));
    execSync(
      `npx gltf-transform optimize "${target}" "${tmpOut}" --compress draco --texture-compress webp`,
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    copyFileSync(tmpOut, target);

    const afterBytes = statSync(target).size;
    totalAfter += afterBytes;

    const ratio = ((1 - afterBytes / beforeBytes) * 100).toFixed(1);
    console.log(`  ${target.padEnd(38)} ${fmt(beforeBytes).padStart(9)} → ${fmt(afterBytes).padStart(9)}  (-${ratio}%)`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const totalRatio = ((1 - totalAfter / totalBefore) * 100).toFixed(1);
console.log(`\n  ${'TOTAL'.padEnd(38)} ${fmt(totalBefore).padStart(9)} → ${fmt(totalAfter).padStart(9)}  (-${totalRatio}%)`);
