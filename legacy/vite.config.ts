import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5183 },
  build: { chunkSizeWarningLimit: 3000 },
});
