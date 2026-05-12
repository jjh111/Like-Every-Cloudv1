import {
  BoxGeometry,
  CanvasTexture,
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
  cassettePast: 0x9b6d4d,
  cassettePresent: 0x4d8a9b,
  counter: 0x4a3826,
  heroPast: 0x1a1a1a,
  heroPresent: 0x1a2238,
} as const;

// (label, trackId) pairs. Cycled across the cassettes so each label always
// resolves to the same track. test_music_1 is reserved for the ambient bed.
const CASSETTE_TRACKS: Array<{ label: string; trackId: string }> = [
  { label: 'Hamid', trackId: 'test_music_2' },
  { label: 'Mahamat A.', trackId: 'test_music_3' },
  { label: 'Mahamat M.', trackId: 'test_music_4' },
  { label: 'Hanaan', trackId: 'test_music_5' },
];

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

// Generate a "cassette label" texture: solid background with a paper stripe
// across the middle and the artist name handwritten on it. Applied to all
// faces of the cassette box — the relevant face shows on the shelf.
function labeledCassetteMaterial(label: string, bgColor: number): MeshStandardMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#' + bgColor.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#f5e9d0';
    ctx.fillRect(12, 36, 232, 56);
    ctx.fillStyle = '#222';
    ctx.font = 'italic 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 64);
  }
  const texture = new CanvasTexture(canvas);
  return new MeshStandardMaterial({ map: texture });
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
  for (let i = 0; i < 3; i++) {
    const shelf = box([0.4, 0.05, 4.5], COLORS.shelfPast);
    shelf.position.set(-2.7, 0.7 + i * 0.7, 0);
    out.push(tagged(shelf, 'past'));
  }
  for (let i = 0; i < 3; i++) {
    const shelf = box([0.4, 0.05, 4.5], COLORS.shelfPresent);
    shelf.position.set(2.7, 0.7 + i * 0.7, 0);
    out.push(tagged(shelf, 'present'));
  }
  return out;
}

function buildCassettes(state: 'past' | 'present'): Object3D[] {
  const out: Object3D[] = [];
  const isPast = state === 'past';
  const xBase = isPast ? -2.6 : 2.6;
  const color = isPast ? COLORS.cassettePast : COLORS.cassettePresent;
  const prefix = isPast ? 'cassette_past_' : 'cassette_present_';

  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 5; i++) {
      const idx = row * 5 + i;
      const pair = CASSETTE_TRACKS[idx % CASSETTE_TRACKS.length];
      const cassette = new Mesh(
        new BoxGeometry(0.25, 0.15, 0.3),
        labeledCassetteMaterial(pair.label, color),
      );
      cassette.position.set(xBase, 0.82 + row * 0.7, -1.8 + i * 0.9);
      const heroId = `${prefix}${String(idx + 1).padStart(2, '0')}`;
      tagged(cassette, state, heroId);
      cassette.userData.track_id = pair.trackId;
      cassette.userData.audio_source_hero_id = isPast
        ? 'hero_boombox_past'
        : 'hero_boombox_present';
      out.push(cassette);
    }
  }
  return out;
}

function buildCounter(): Object3D[] {
  const counter = box([2.5, 1, 0.7], COLORS.counter);
  counter.position.set(0, 0.5, -2);
  return [tagged(counter, 'both')];
}

function buildBoomboxes(): Object3D[] {
  // Emissive setup so the boombox can light up while music plays. The tick
  // loop in app.ts toggles emissiveIntensity based on music-channel activity.
  const heroPast = new Mesh(
    new BoxGeometry(0.5, 0.3, 0.35),
    new MeshStandardMaterial({
      color: COLORS.heroPast,
      emissive: 0xff8855,
      emissiveIntensity: 0,
    }),
  );
  heroPast.position.set(-0.7, 1.15, -1.9);
  tagged(heroPast, 'past', 'hero_boombox_past');

  const heroPresent = new Mesh(
    new BoxGeometry(0.5, 0.3, 0.35),
    new MeshStandardMaterial({
      color: COLORS.heroPresent,
      emissive: 0x55a5ff,
      emissiveIntensity: 0,
    }),
  );
  heroPresent.position.set(0.7, 1.15, -1.9);
  tagged(heroPresent, 'present', 'hero_boombox_present');

  return [heroPast, heroPresent];
}

export function buildPlaceholderScene(): Object3D[] {
  return [
    ...buildShell(),
    ...buildShelves(),
    ...buildCassettes('past'),
    ...buildCassettes('present'),
    ...buildCounter(),
    ...buildBoomboxes(),
  ];
}
