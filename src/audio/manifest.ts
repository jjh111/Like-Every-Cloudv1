// Audio assets to preload at boot. Add tracks here and reference them by id
// in src/interaction/rules.ts (or via cassette userData.track_id). The system
// doesn't care what the source format is as long as the browser can decode it
// (mp3, m4a/aac, ogg, wav, opus).
export interface AudioAsset {
  id: string;
  url: string;
}

export const AUDIO_ASSETS: AudioAsset[] = [
  { id: 'test_music_1', url: '/audio/test_music_1.m4a' },
  { id: 'test_music_2', url: '/audio/test_music_2.mp3' },
  { id: 'test_music_3', url: '/audio/test_music_3.m4a' },
  { id: 'test_music_4', url: '/audio/test_music_4.m4a' },
  { id: 'test_music_5', url: '/audio/test_music_5.mp3' },
];
