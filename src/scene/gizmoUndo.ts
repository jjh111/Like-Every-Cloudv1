import { Matrix4, type Object3D } from 'three';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';

// Bounded undo/redo stack for gizmo edits.
//
// Capture model: on 'mouseDown' (drag start) we snapshot the target's local
// matrix as the "before" state. On 'mouseUp' (drag end) we snapshot the
// post-state and push a record to the undo stack. ⌘Z / ⌃Z pops the latest
// record and restores the "before"; ⌘⇧Z / ⌃⇧Z (or ⌘Y) restores the "after".
//
// Why local matrices: gizmo edits in this app are always on the object's
// own transform (translate/rotate), never on its parent. Snapshotting
// .matrix is cheaper than re-decomposing position/quaternion/scale and is
// lossless for the data we care about.
//
// The two TransformControls instances (translate + rotate) share one stack:
// pointer can only drag one at a time, and undoing a translate after a
// rotate is the natural expectation.
export interface GizmoUndoDeps {
  controls: TransformControls[];
  /** Cap on stack size — old entries drop off the bottom. */
  maxDepth?: number;
}

interface UndoRecord {
  obj: Object3D;
  before: Matrix4;
  after: Matrix4;
}

export interface GizmoUndo {
  /** Push a record manually (e.g. after a programmatic move). */
  push(obj: Object3D, before: Matrix4, after: Matrix4): void;
  undo(): boolean;
  redo(): boolean;
  /** Wipe both stacks — call after a save so undo can't roll back persisted edits. */
  clear(): void;
  dispose(): void;
}

const restoreLocal = (obj: Object3D, m: Matrix4): void => {
  // Decompose + reassign so children rendered relative to this object stay
  // visually consistent. obj.matrix.copy(m) alone wouldn't update
  // position/quaternion/scale, and the next .updateMatrix() would clobber it.
  m.decompose(obj.position, obj.quaternion, obj.scale);
  obj.updateMatrix();
};

export function createGizmoUndo(deps: GizmoUndoDeps): GizmoUndo {
  const maxDepth = deps.maxDepth ?? 100;
  const undoStack: UndoRecord[] = [];
  const redoStack: UndoRecord[] = [];

  // Per-controller capture of "before" matrix while a drag is in flight.
  // A controller without an active drag has no entry.
  const draggingFrom = new Map<TransformControls, { obj: Object3D; before: Matrix4 }>();

  const push = (obj: Object3D, before: Matrix4, after: Matrix4): void => {
    undoStack.push({ obj, before, after });
    if (undoStack.length > maxDepth) undoStack.shift();
    // Any new edit invalidates the redo branch — same model as every text
    // editor's undo, avoids weird "history forks" UX.
    redoStack.length = 0;
  };

  const onMouseDown = (controls: TransformControls): void => {
    const obj = controls.object;
    if (!obj) return;
    draggingFrom.set(controls, { obj, before: obj.matrix.clone() });
  };

  const onMouseUp = (controls: TransformControls): void => {
    const start = draggingFrom.get(controls);
    draggingFrom.delete(controls);
    if (!start) return;
    const after = start.obj.matrix.clone();
    // No-op drags (click without move) shouldn't pollute the stack.
    if (matricesEqual(start.before, after)) return;
    push(start.obj, start.before, after);
  };

  const listenersPerControls: Array<{ controls: TransformControls; down: () => void; up: () => void }> = [];
  for (const c of deps.controls) {
    const down = () => onMouseDown(c);
    const up = () => onMouseUp(c);
    c.addEventListener('mouseDown', down);
    c.addEventListener('mouseUp', up);
    listenersPerControls.push({ controls: c, down, up });
  }

  const undo = (): boolean => {
    const rec = undoStack.pop();
    if (!rec) return false;
    restoreLocal(rec.obj, rec.before);
    redoStack.push(rec);
    return true;
  };

  const redo = (): boolean => {
    const rec = redoStack.pop();
    if (!rec) return false;
    restoreLocal(rec.obj, rec.after);
    undoStack.push(rec);
    return true;
  };

  const onKey = (e: KeyboardEvent): void => {
    // Only fire when the user is genuinely in the 3D viewport — don't steal
    // keyboard from text inputs (e.g. a bookmark-name prompt).
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (e.key === 'y' || e.key === 'Y') {
      // Windows-style redo.
      e.preventDefault();
      redo();
    }
  };
  window.addEventListener('keydown', onKey);

  const clear = (): void => {
    undoStack.length = 0;
    redoStack.length = 0;
  };

  const dispose = (): void => {
    for (const { controls, down, up } of listenersPerControls) {
      controls.removeEventListener('mouseDown', down);
      controls.removeEventListener('mouseUp', up);
    }
    window.removeEventListener('keydown', onKey);
    clear();
  };

  return { push, undo, redo, clear, dispose };
}

// Cheap "are these matrices the same to 5 decimal places" — used to skip
// no-op drags. epsilon chosen well above float32 noise but small enough
// that any real translate (≥1mm) registers.
function matricesEqual(a: Matrix4, b: Matrix4, eps = 1e-5): boolean {
  const ea = a.elements;
  const eb = b.elements;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(ea[i] - eb[i]) > eps) return false;
  }
  return true;
}
