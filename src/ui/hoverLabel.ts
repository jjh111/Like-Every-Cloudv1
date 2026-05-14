import type { PointerInteraction } from '../interaction/pointer';

// Floating tooltip that follows the cursor while hovering an interactive
// object. Shows hero_id by default; can be extended later to include state,
// audio source, etc. Subscribes to PointerInteraction.on('hoverIn'/'hoverOut')
// so the lifecycle stays inside the existing pointer pipeline — no extra
// raycasts.
//
// Useful for a "Chad cassette shop" tour where the user needs to figure out
// which photoscan mesh corresponds to which clickable thing without poking
// it first.
export interface HoverLabelDeps {
  pointer: PointerInteraction;
  /** DOM element to position the label relative to (usually renderer.domElement). */
  domElement: HTMLElement;
  /** Optional formatter for the label text. Default: hero_id. */
  formatLabel?: (info: { heroId?: string; userData?: Record<string, unknown> }) => string;
}

export function createHoverLabel(deps: HoverLabelDeps): { dispose: () => void } {
  const { pointer, domElement } = deps;
  const formatLabel = deps.formatLabel ?? ((info) => info.heroId ?? '');

  const el = document.createElement('div');
  el.style.cssText = [
    'position: fixed',
    'pointer-events: none',
    'padding: 4px 8px',
    'background: rgba(15, 15, 15, 0.85)',
    'color: #cfe9b3',
    'font: 11px/1.2 ui-monospace, Menlo, monospace',
    'border-radius: 6px',
    'border: 1px solid rgba(159, 214, 107, 0.35)',
    'backdrop-filter: blur(4px)',
    'z-index: 1100',
    'opacity: 0',
    'transition: opacity 80ms ease-out',
    'transform: translate(12px, 12px)',
    'white-space: nowrap',
  ].join('; ');
  document.body.appendChild(el);

  let visible = false;
  let lastX = 0;
  let lastY = 0;

  const reposition = (): void => {
    el.style.left = lastX + 'px';
    el.style.top = lastY + 'px';
  };

  // Track raw pointer so the label follows even between hover events.
  const onMove = (e: PointerEvent): void => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (visible) reposition();
  };
  domElement.addEventListener('pointermove', onMove);

  const unsubIn = pointer.on('hoverIn', (info) => {
    const text = formatLabel({ heroId: info.heroId, userData: info.object.userData as Record<string, unknown> });
    if (!text) return;
    el.textContent = text;
    visible = true;
    reposition();
    el.style.opacity = '1';
  });
  const unsubOut = pointer.on('hoverOut', () => {
    visible = false;
    el.style.opacity = '0';
  });

  return {
    dispose: () => {
      unsubIn();
      unsubOut();
      domElement.removeEventListener('pointermove', onMove);
      el.remove();
    },
  };
}
