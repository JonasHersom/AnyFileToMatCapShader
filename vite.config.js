import { defineConfig } from 'vite';

// Configure base path for DTU deployment
// Change this to your DTU subpath, e.g. '/~username/project/'
const BASE_PATH = '/';

export default defineConfig({
  base: BASE_PATH,
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Copy public/models to dist/models
    rollupOptions: {
      input: 'index.html',
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  // Handle WASM imports from converter if needed
  // optimizeDeps: {
  //   exclude: ['@mediabunny/*', '@imagemagick/*', 'mupdf'], // converter's WASM deps
  // },
});