import type { AudioManager } from '../audio/audioManager';

// Bottom-center floating pill (sits above the tracks bar): mute toggle +
// master volume. Mute starts on; the first click both unmutes and resumes
// the AudioContext (first-gesture requirement). External mutations (dev
// panel slider) flow back through the poll loop so the UI stays in sync.
//
// Co-located with the tracks bar so the entire audio cluster lives at the
// bottom center of the viewport — `bottom` offset matches the tracks bar's
// expected height + a small gap, keeping them visually grouped.
export function createAudioControls(audio: AudioManager): void {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'position: fixed',
    'bottom: 86px',
    'left: 50%',
    'transform: translateX(-50%)',
    'display: flex',
    'align-items: center',
    'gap: 10px',
    'padding: 8px 14px',
    'background: rgba(15, 15, 15, 0.7)',
    'color: #ddd',
    'font: 13px/1.3 system-ui, sans-serif',
    'border-radius: 999px',
    'backdrop-filter: blur(6px)',
    'z-index: 1000',
    'user-select: none',
  ].join('; ');

  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.style.cssText = [
    'background: none',
    'border: 1px solid rgba(255,255,255,0.25)',
    'color: #ddd',
    'padding: 6px 12px',           // touch-friendly target
    'border-radius: 999px',
    'cursor: pointer',
    'font: inherit',
    'min-width: 92px',
    'touch-action: manipulation',
  ].join('; ');
  const renderBtn = () => {
    muteBtn.textContent = audio.muted ? '🔇 muted' : '🔊 sound on';
  };
  renderBtn();
  muteBtn.addEventListener('click', async () => {
    try { await audio.resume(); } catch { /* ignored */ }
    // Auto-bump from near-zero so unmute actually produces sound.
    if (audio.muted && audio.getMasterVolume() < 0.05) {
      audio.setMasterVolume(0.7);
      slider.value = '0.7';
    }
    audio.setMuted(!audio.muted);
    renderBtn();
  });

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.01';
  slider.value = String(audio.getMasterVolume());
  slider.style.cssText = 'width: 120px; accent-color: #ddd; cursor: pointer;';
  slider.addEventListener('input', () => {
    audio.setMasterVolume(Number(slider.value));
  });

  wrapper.appendChild(muteBtn);
  wrapper.appendChild(slider);
  document.body.appendChild(wrapper);

  // Keep button + slider in sync if mute/volume change elsewhere (dev panel).
  setInterval(() => {
    renderBtn();
    const cur = String(audio.getMasterVolume());
    if (slider.value !== cur && document.activeElement !== slider) {
      slider.value = cur;
    }
  }, 200);
}
