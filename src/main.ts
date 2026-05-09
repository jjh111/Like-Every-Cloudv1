import { start } from './app';

const container = document.getElementById('app');
if (!container) throw new Error('#app element not found');

start(container).catch((err) => {
  console.error('[LEC] startup failed:', err);
});
