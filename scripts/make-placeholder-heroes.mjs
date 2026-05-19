#!/usr/bin/env node
// Generate small placeholder GLBs for the sound-emitting heroes that don't
// yet have authored geometry (sewing machine, fan, motorcycle, generator).
//
// Each output is a single sphere (~12cm diameter) with an unlit pastel color
// per category, so the dev panel can see + move them around. The audio system
// resolves a `heroId` to one of these spheres for spatial-anchoring; once a
// real Blender export lands, drop in the real GLB and remove this entry from
// PLACEHOLDERS — the manifest entry stays the same.
//
// Implementation: @gltf-transform/core programmatic API — pure JS, no
// headless three.js needed. The generated files are ~1-2 KB each.
//
// Usage:
//   node scripts/make-placeholder-heroes.mjs

import { Document, NodeIO, Accessor } from '@gltf-transform/core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT_ROOT = 'public/heroes';

// hero_id → { color: [r,g,b] in 0..1, radius in metres }. Distinct hues so
// it's obvious which placeholder is which when half a dozen sit in the same
// world space.
const PLACEHOLDERS = [
  { id: 'hero_sewing',     color: [0.94, 0.58, 0.62], radius: 0.06 }, // warm pink
  { id: 'hero_fan',        color: [0.62, 0.82, 0.94], radius: 0.06 }, // cool blue
  { id: 'hero_motorcycle', color: [0.96, 0.78, 0.45], radius: 0.06 }, // amber
  { id: 'hero_generator',  color: [0.55, 0.82, 0.60], radius: 0.06 }, // green
];

// Build a low-poly UV sphere as float32 position+normal+index arrays.
// 12×8 = 96 quads, ~190 tris — small enough that Draco compression is
// pointless (the GLB is already tiny). Normals are radial.
function buildSphere(radius, segments = 12, rings = 8) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const phi = v * Math.PI;
    const y = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    for (let s = 0; s <= segments; s++) {
      const u = s / segments;
      const theta = u * Math.PI * 2;
      const x = sinPhi * Math.cos(theta);
      const z = sinPhi * Math.sin(theta);
      positions.push(x * radius, y * radius, z * radius);
      normals.push(x, y, z);
    }
  }

  const cols = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * cols + s;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

const io = new NodeIO();

for (const { id, color, radius } of PLACEHOLDERS) {
  const doc = new Document();
  doc.createBuffer();

  const { positions, normals, indices } = buildSphere(radius);

  const posAcc = doc.createAccessor()
    .setArray(positions)
    .setType(Accessor.Type.VEC3);
  const normAcc = doc.createAccessor()
    .setArray(normals)
    .setType(Accessor.Type.VEC3);
  const idxAcc = doc.createAccessor()
    .setArray(indices)
    .setType(Accessor.Type.SCALAR);

  const material = doc.createMaterial(`${id}_mat`)
    .setBaseColorFactor([...color, 1.0])
    // Soft, faintly emissive look so the placeholder reads as
    // "this is a debug marker, not real geometry."
    .setMetallicFactor(0.0)
    .setRoughnessFactor(0.8)
    .setEmissiveFactor([color[0] * 0.25, color[1] * 0.25, color[2] * 0.25]);

  const prim = doc.createPrimitive()
    .setAttribute('POSITION', posAcc)
    .setAttribute('NORMAL', normAcc)
    .setIndices(idxAcc)
    .setMaterial(material);

  const mesh = doc.createMesh(`${id}_mesh`).addPrimitive(prim);
  const node = doc.createNode(id).setMesh(mesh);
  doc.createScene().addChild(node);

  const dest = `${OUT_ROOT}/${id}.glb`;
  mkdirSync(dirname(dest), { recursive: true });
  await io.write(dest, doc);
  console.log(`  wrote ${dest}`);
}

console.log(`\nGenerated ${PLACEHOLDERS.length} placeholder hero${PLACEHOLDERS.length === 1 ? '' : 's'}.`);
