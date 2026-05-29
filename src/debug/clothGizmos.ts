import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import type { ClothPatch } from '../scene/clothPatch';
import { devBus } from './devBus';

// Cloth gizmos — wireframe + pin markers + grab marker.
//
// One LineSegments per registered cloth, whose position attribute SHARES
// the cloth's internal Float32Array (zero-copy). Each tick we just flag
// the attribute dirty and the wireframe follows the sim. The index buffer
// (constraint pairs) is built once from `cloth.buildConstraintLineIndices()`
// and never changes.
//
// Pin markers: small spheres at every pinned particle (yellow). Built
// once at registration; positions update each tick from the same shared
// Float32Array.
//
// Grab marker: one slightly larger cyan sphere following the currently
// grabbed particle. Shown only while a grab is active (driven by
// `cloth:grab` / `cloth:release` events).

const PIN_COLOR = 0xffe066;       // soft amber
const GRAB_COLOR = 0x66ffe6;      // dev cyan
const WIRE_COLOR = 0xeaf3ff;      // pale cool

interface Registered {
  cloth: ClothPatch;
  wireframe: LineSegments;
  pinMeshes: Mesh[];          // one per pinned particle
  grabMesh: Mesh;             // visible only while grabbing
  unsubs: Array<() => void>;
}

export class ClothGizmos {
  private group: Group;
  private items: Registered[] = [];
  private scratch = new Vector3();

  constructor(parent: Group) {
    this.group = parent;
  }

  /** Add a cloth to the visualization. Idempotent — re-registering the
   *  same cloth is a no-op. Returns immediately. */
  register(cloth: ClothPatch): void {
    if (this.items.some((it) => it.cloth === cloth)) return;

    // Wireframe — shared buffer.
    const wireGeom = new BufferGeometry();
    wireGeom.setAttribute('position', new BufferAttribute(cloth.positionsBuffer, 3));
    wireGeom.setIndex(new BufferAttribute(cloth.buildConstraintLineIndices(), 1));
    const wireMat = new LineBasicMaterial({
      color: new Color(WIRE_COLOR),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const wireframe = new LineSegments(wireGeom, wireMat);
    wireframe.renderOrder = 980;
    wireframe.userData.no_cull = true;
    wireframe.userData.raycastIgnore = true;
    wireframe.userData.no_outline = true;
    wireframe.userData.no_highlight = true;
    wireframe.frustumCulled = false;
    this.group.add(wireframe);

    // Pin markers.
    const pinMeshes: Mesh[] = [];
    const pinGeom = new IcosahedronGeometry(0.025, 1);
    const pinMat = new MeshBasicMaterial({ color: new Color(PIN_COLOR) });
    for (let i = 0; i < cloth.particleCount; i++) {
      if (cloth.pinnedFlags[i] !== 1) continue;
      const mesh = new Mesh(pinGeom, pinMat);
      mesh.renderOrder = 985;
      mesh.userData.no_cull = true;
      mesh.userData.raycastIgnore = true;
      mesh.userData.no_outline = true;
      mesh.userData.no_highlight = true;
      mesh.position.fromArray(cloth.positionsBuffer, i * 3);
      this.group.add(mesh);
      pinMeshes.push(mesh);
      mesh.userData.particleIndex = i; // used in update
    }

    // Grab marker — invisible until grab event.
    const grabGeom = new IcosahedronGeometry(0.05, 1);
    const grabMat = new MeshBasicMaterial({ color: new Color(GRAB_COLOR), transparent: true, opacity: 0.9 });
    const grabMesh = new Mesh(grabGeom, grabMat);
    grabMesh.visible = false;
    grabMesh.renderOrder = 986;
    grabMesh.userData.no_cull = true;
    grabMesh.userData.raycastIgnore = true;
    grabMesh.userData.no_outline = true;
    grabMesh.userData.no_highlight = true;
    this.group.add(grabMesh);

    const unsubs: Array<() => void> = [];
    // Filter events by cloth id so multiple cloths don't cross-trigger.
    unsubs.push(devBus.on('cloth:grab', (p) => {
      if (p.cloth !== cloth.id) return;
      grabMesh.visible = true;
    }));
    unsubs.push(devBus.on('cloth:release', (p) => {
      if (p.cloth !== cloth.id) return;
      grabMesh.visible = false;
    }));

    this.items.push({ cloth, wireframe, pinMeshes, grabMesh, unsubs });
  }

  /** Per-frame refresh — flush shared buffers and follow pin/grab particles. */
  update(): void {
    if (!this.group.visible) return;
    for (const it of this.items) {
      // Wireframe — flush the shared position buffer.
      (it.wireframe.geometry.attributes.position as BufferAttribute).needsUpdate = true;
      // Pin markers — follow their particle (pins can move when grabbed
      // mid-row; permanent pins are no-op but the cost is trivial).
      for (const m of it.pinMeshes) {
        const i = m.userData.particleIndex as number;
        m.position.fromArray(it.cloth.positionsBuffer, i * 3);
      }
      // Grab marker.
      const gi = it.cloth.currentGrabIndex;
      if (gi >= 0 && it.grabMesh.visible) {
        it.cloth.getParticlePosition(gi, this.scratch);
        it.grabMesh.position.copy(this.scratch);
      }
    }
  }

  dispose(): void {
    for (const it of this.items) {
      for (const fn of it.unsubs) fn();
      this.group.remove(it.wireframe);
      it.wireframe.geometry.dispose();
      (it.wireframe.material as LineBasicMaterial).dispose();
      for (const m of it.pinMeshes) this.group.remove(m);
      // pin geometry/material is shared per-cloth — dispose only once
      if (it.pinMeshes[0]) {
        it.pinMeshes[0].geometry.dispose();
        (it.pinMeshes[0].material as MeshBasicMaterial).dispose();
      }
      this.group.remove(it.grabMesh);
      it.grabMesh.geometry.dispose();
      (it.grabMesh.material as MeshBasicMaterial).dispose();
    }
    this.items = [];
  }
}
