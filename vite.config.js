import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  optimizeDeps: {
    exclude: ['three-mesh-bvh/worker'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
