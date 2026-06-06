import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  // Local dev only — see ../DEV-PORTS.md (5173 is Island Dreamforge).
  server: { port: 5174, strictPort: false },
  preview: { port: 4174, strictPort: false },
  // Mermaid is large and often added while the dev server is already running;
  // pre-bundle it so diagram blocks do not hit 504 Outdated Optimize Dep.
  optimizeDeps: {
    include: ['mermaid'],
  },
});
