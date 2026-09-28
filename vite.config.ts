import { defineConfig } from 'vite';

/* Cross-origin isolation unlocks SharedArrayBuffer, which Box3D's multithreaded solver needs.
   `credentialless` (not require-corp) keeps no-cors third-party assets like Google Fonts loading. */
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  base: './',
  server: { port: 5183, headers: isolation },
  preview: { headers: isolation },
  /* box3d.js resolves its worker and .wasm relative to its own module URL; pre-bundling would break that */
  optimizeDeps: { exclude: ['box3d.js'] },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 4000, target: 'es2022' },
});
