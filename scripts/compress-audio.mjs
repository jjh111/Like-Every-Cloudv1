#!/usr/bin/env node
// Encode WAVs from `Working - gitignore/Sounds/` to AAC-LC m4a in
// `public/audio/sfx/`. Source files are huge (96kHz, uncompressed) — this
// pass typically shrinks the bundle 50–100× while keeping web-acceptable
// quality for ambient/SFX use.
//
// Codec choice: AAC-LC at 128 kbps stereo, 44.1 kHz. Universally decodable
// (no HE-AAC support gaps on older Safari), small enough for ambient beds,
// enough headroom for one-shots that play loud (motorcycle pass-by).
//
// Why a hard-coded mapping table: the source filenames have spaces, commas,
// and library suffixes like `SND62906`. The runtime ids reference the m4a
// names, so a stable rename happens here once rather than in a slugifier
// every run.
//
// Usage:
//   npm run compress-audio              # encode all entries below
//   npm run compress-audio fan          # only entries whose dest matches

import { execSync } from 'node:child_process';
import { statSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SRC_ROOT = 'Working - gitignore/Sounds';
const DEST_ROOT = 'public/audio/sfx';

// Source path → destination path. Destination filenames are the slugs that
// runtime ids reference (e.g. `sfx_fan_oscillation` → `fan/fan_oscillation.m4a`).
// Add a row to surface a new asset; the audio manifest in
// `src/audio/manifest.ts` registers the id.
const MAP = [
  // Fan — interior ambient
  ['Fan/Fan sense of oscillation.wav', 'fan/fan_oscillation.m4a'],
  ['Fan/Fan running 1.wav',            'fan/fan_running_1.m4a'],
  ['Fan/Fan running 2.wav',            'fan/fan_running_2.m4a'],
  ['Fan/Fan running 3.wav',            'fan/fan_running_3.m4a'],
  ['Fan/Fan start speed 1.wav',        'fan/fan_start_1.m4a'],
  ['Fan/Fan start speed 2.wav',        'fan/fan_start_2.m4a'],
  ['Fan/Fan start speed 3.wav',        'fan/fan_start_3.m4a'],
  // Sewing — present-state focal bed
  ['Sewing Machine/Sewing hard hum.wav',       'sewing/sewing_hum.m4a'],
  ['Sewing Machine/Heavy work.wav',            'sewing/sewing_heavy.m4a'],
  ['Sewing Machine/Start and stop.wav',        'sewing/sewing_start_stop.m4a'],
  ['Sewing Machine/Bit by bit iterations.wav', 'sewing/sewing_iterations.m4a'],
  // Generator — exterior bed, audible inside at low volume
  ['Generator/Machines, Pump, Portable Generator, Close Loop SND62906.wav', 'generator/gen_loop.m4a'],
  ['Generator/Motors, Combustion, Power Generator Close Motor SND80837.wav', 'generator/gen_motor.m4a'],
  // Motorcycle — one-shot events
  ['Motorcycle/Moto pass by.wav',        'motorcycle/moto_passby.m4a'],
  ['Motorcycle/Moto arrival.wav',        'motorcycle/moto_arrival.m4a'],
  ['Motorcycle/Moto engine start 1.wav', 'motorcycle/moto_start_1.m4a'],
  ['Motorcycle/Moto engine start 2.wav', 'motorcycle/moto_start_2.m4a'],
  ['Motorcycle/Moto rev engine.wav',     'motorcycle/moto_rev.m4a'],
];

const filter = process.argv[2];
const selected = filter
  ? MAP.filter(([, d]) => d.includes(filter))
  : MAP;

if (selected.length === 0) {
  console.error(`No targets match "${filter}".`);
  process.exit(1);
}

const fmt = (bytes) => {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
};

console.log(`Encoding ${selected.length} file${selected.length === 1 ? '' : 's'}…\n`);

let totalBefore = 0;
let totalAfter = 0;
let skipped = 0;

for (const [srcRel, destRel] of selected) {
  const src = join(SRC_ROOT, srcRel);
  const dest = join(DEST_ROOT, destRel);

  if (!existsSync(src)) {
    console.warn(`  skip — missing: ${src}`);
    skipped++;
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });

  const beforeBytes = statSync(src).size;
  totalBefore += beforeBytes;

  // -y overwrite, AAC-LC at 128k, downsample to 44.1 kHz, force stereo so
  // PannerNode has channels to pan; mono sources get duped to L+R.
  try {
    execSync(
      `ffmpeg -y -i "${src}" -c:a aac -b:a 128k -ar 44100 -ac 2 "${dest}"`,
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
  } catch (err) {
    console.error(`  ✗ failed: ${destRel}\n    ${err.message.split('\n')[0]}`);
    continue;
  }

  const afterBytes = statSync(dest).size;
  totalAfter += afterBytes;
  const pct = ((1 - afterBytes / beforeBytes) * 100).toFixed(1);
  console.log(`  ${destRel.padEnd(40)} ${fmt(beforeBytes).padStart(10)} → ${fmt(afterBytes).padStart(9)}  (-${pct}%)`);
}

if (skipped) console.log(`\nSkipped ${skipped} missing source${skipped === 1 ? '' : 's'}.`);
if (totalBefore > 0) {
  const totalPct = ((1 - totalAfter / totalBefore) * 100).toFixed(1);
  console.log(`\nTotal:  ${fmt(totalBefore)} → ${fmt(totalAfter)}  (-${totalPct}%)`);
}
