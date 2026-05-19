// Top-left brand badge. Always visible (both demo + dev views). In dev view
// the hero audio mixer sits below this badge — see heroAudioMixer.ts which
// hard-codes its top offset to clear the badge height.
//
// Size is intentionally modest so it doesn't fight the scene for attention.
// Sized by HEIGHT with auto width so the badge follows the logo's natural
// aspect — swap a square icon for a wordmark (or vice versa) without
// touching this file.
//
// Click jumps to the project homepage if one is configured; otherwise it's
// passive ornament.
export function createLogoBadge(opts: { href?: string; height?: number } = {}): void {
  const height = opts.height ?? 48;
  const wrapper = document.createElement(opts.href ? 'a' : 'div');
  if (opts.href && wrapper instanceof HTMLAnchorElement) {
    wrapper.href = opts.href;
    wrapper.target = '_blank';
    wrapper.rel = 'noopener noreferrer';
  }
  wrapper.title = 'Like Every Cloud';
  wrapper.style.cssText = [
    'position: fixed',
    'top: 16px',
    'left: 16px',
    `height: ${height}px`,
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'z-index: 1000',
    // Soft glass card behind the icon so the SVG's dark navy strokes read
    // against the cloudy sky gradient instead of disappearing into it.
    'background: rgba(255, 255, 255, 0.18)',
    'border: 1px solid rgba(255, 255, 255, 0.35)',
    'border-radius: 14px',
    'backdrop-filter: blur(6px)',
    'padding: 6px 10px',
    'box-sizing: border-box',
    'user-select: none',
    'pointer-events: ' + (opts.href ? 'auto' : 'none'),
    'transition: transform 200ms ease, background 200ms ease',
  ].join('; ');

  const img = document.createElement('img');
  img.src = '/like-every-cloud.svg';
  img.alt = 'Like Every Cloud';
  img.draggable = false;
  // Height-fill, width-auto → wordmark stays at native aspect inside the
  // padded glass card; viewBox of the SVG drives the final box width.
  img.style.cssText = 'height: 100%; width: auto; display: block; pointer-events: none;';
  wrapper.appendChild(img);

  if (opts.href) {
    wrapper.addEventListener('pointerenter', () => {
      wrapper.style.background = 'rgba(255, 255, 255, 0.28)';
      wrapper.style.transform = 'scale(1.04)';
    });
    wrapper.addEventListener('pointerleave', () => {
      wrapper.style.background = 'rgba(255, 255, 255, 0.18)';
      wrapper.style.transform = '';
    });
  }

  document.body.appendChild(wrapper);
}
