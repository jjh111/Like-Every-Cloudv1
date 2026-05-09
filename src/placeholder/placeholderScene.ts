import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Object3D,
} from 'three';
import { tagInteractive, tagState, type StateTag } from '../scene/tagging';

// Square interior placeholder — stand-in for the Chad cassette shop.
// Real geometry replaces this once the Rhino → Blender → glTF pipeline lands.
export const PLACEHOLDER_ROOM = {
  width: 6,
  depth: 6,
  height: 3,
};

const COLORS = {
  shell: 0xc7b9a3,
  floor: 0x6e5c45,
  ceiling: 0xd0c4b0,
  shelfPast: 0x6b4a32,
  shelfPresent: 0x9a9a9a,
  productPast: 0x9b6d4d,
  productPresent: 0x4d8a9b,
  counter: 0x4a3826,
  heroPast: 0x1a1a1a,
  heroPresent: 0x1a2238,
} as const;

function box(size: [number, number, number], color: number): Mesh {
  return new Mesh(
    new BoxGeometry(...size),
    new MeshStandardMaterial({ color }),
  );
}

function tagged(mesh: Mesh, tag: StateTag, heroId?: string): Mesh {
  tagState(mesh, tag);
  if (heroId) tagInteractive(mesh, heroId);
  return mesh;
}

function buildShell(): Object3D[] {
  const out: Object3D[] = [];
  const W = PLACEHOLDER_ROOM.width;
  const D = PLACEHOLDER_ROOM.depth;
  const H = PLACEHOLDER_ROOM.height;
  const T = 0.1;

  const floor = new Mesh(
    new PlaneGeometry(W, D),
    new MeshStandardMaterial({ color: COLORS.floor }),
  );
  floor.rotation.x = -Math.PI / 2;
  out.push(tagged(floor, 'both'));

  const ceiling = new Mesh(
    new PlaneGeometry(W, D),
    new MeshStandardMaterial({ color: COLORS.ceiling }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  out.push(tagged(ceiling, 'both'));

  const back = box([W, H, T], COLORS.shell);
  back.position.set(0, H / 2, -D / 2);
  out.push(tagged(back, 'both'));

  const left = box([T, H, D], COLORS.shell);
  left.position.set(-W / 2, H / 2, 0);
  out.push(tagged(left, 'both'));

  const right = box([T, H, D], COLORS.shell);
  right.position.set(W / 2, H / 2, 0);
  out.push(tagged(right, 'both'));

  // Front wall split for a 2m doorway in the middle
  const sideW = (W - 2) / 2;
  const frontL = box([sideW, H, T], COLORS.shell);
  frontL.position.set(-(sideW / 2 + 1), H / 2, D / 2);
  out.push(tagged(frontL, 'both'));
  const frontR = box([sideW, H, T], COLORS.shell);
  frontR.position.set(sideW / 2 + 1, H / 2, D / 2);
  out.push(tagged(frontR, 'both'));
  const lintel = box([2, 0.5, T], COLORS.shell);
  lintel.position.set(0, H - 0.25, D / 2);
  out.push(tagged(lintel, 'both'));

  return out;
}

function buildShelves(): Object3D[] {
  const out: Object3D[] = [];

  // Left wall: past shelves
  for (let i = 0; i < 3; i++) {
    const shelf = box([0.4, 0.05, 4.5], COLORS.shelfPast);
    shelf.position.set(-2.7, 0.7 + i * 0.7, 0);
    out.push(tagged(shelf, 'past'));
  }
  // Right wall: present shelves
  for (let i = 0; i < 3; i++) {
    const shelf = box([0.4, 0.05, 4.5], COLORS.shelfPresent);
    shelf.position.set(2.7, 0.7 + i * 0.7, 0);
    out.push(tagged(shelf, 'present'));
  }

  // Cassettes on past shelves
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 5; i++) {
      const cassette = box([0.25, 0.15, 0.3], COLORS.productPast);
      cassette.position.set(-2.6, 0.82 + row * 0.7, -1.8 + i * 0.9);
      out.push(tagged(cassette, 'past'));
    }
  }
  // Cassettes on present shelves
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 5; i++) {
      const cassette = box([0.25, 0.15, 0.3], COLORS.productPresent);
      cassette.position.set(2.6, 0.82 + row * 0.7, -1.8 + i * 0.9);
      out.push(tagged(cassette, 'present'));
    }
  }

  return out;
}

function buildCounter(): Object3D[] {
  const counter = box([2.5, 1, 0.7], COLORS.counter);
  counter.position.set(0, 0.5, -2);
  return [tagged(counter, 'both')];
}

function buildHeroes(): Object3D[] {
  // Stand-ins for scanned boomboxes — chest-height on the counter.
  const heroPast = box([0.5, 0.3, 0.35], COLORS.heroPast);
  heroPast.position.set(-0.7, 1.15, -1.9);
  tagged(heroPast, 'past', 'hero_boombox_past');

  const heroPresent = box([0.5, 0.3, 0.35], COLORS.heroPresent);
  heroPresent.position.set(0.7, 1.15, -1.9);
  tagged(heroPresent, 'present', 'hero_boombox_present');

  return [heroPast, heroPresent];
}

export function buildPlaceholderScene(): Object3D[] {
  return [
    ...buildShell(),
    ...buildShelves(),
    ...buildCounter(),
    ...buildHeroes(),
  ];
}
