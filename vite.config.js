import { defineConfig } from 'vite';

// GitHub Pages serves from a sub-path (e.g. /<repo>/),
// so we use relative asset URLs.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: {
    port: 5173,
    open: false,
  },
});
