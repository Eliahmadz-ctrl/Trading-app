import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true, // fail loudly instead of silently drifting off 5173
    // Preview proxy: user's browser talks only to this origin; Deriv WS is browser-direct.
  },
  esbuild: {
    target: 'es2020',
  },
});
