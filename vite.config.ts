import { realpathSync } from 'node:fs';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

/* Cross-origin isolation unlocks SharedArrayBuffer, which Box3D's multithreaded solver needs.
   `credentialless` (not require-corp) keeps no-cors third-party assets like Google Fonts loading. */
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  base: './',
  /* git worktrees symlink node_modules to the main checkout; allow serving from its real path too */
  server: { port: 5183, headers: isolation, fs: { allow: [searchForWorkspaceRoot(process.cwd()), realpathSync('node_modules')] } },
  preview: { headers: isolation },
  /* box3d.js resolves its worker and .wasm relative to its own module URL; pre-bundling would break that */
  optimizeDeps: { exclude: ['box3d.js'] },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 4000, target: 'es2022' },
});
