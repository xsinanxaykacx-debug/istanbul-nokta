import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ['**/supabase/**'],
    },
  },
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  build: {
    // The WebLLM package is intentionally lazy-loaded; keep its code out of the app entry chunk.
    chunkSizeWarningLimit: 7000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (!normalizedId.includes('node_modules')) return;

          if (normalizedId.includes('node_modules/@mlc-ai/web-llm/')) {
            return 'webllm-vendor';
          }

          if (normalizedId.includes('node_modules/maplibre-gl/')) {
            return 'maplibre-vendor';
          }

          if (
            normalizedId.includes('node_modules/react/') ||
            normalizedId.includes('node_modules/react-dom/') ||
            normalizedId.includes('node_modules/scheduler/')
          ) {
            return 'react-vendor';
          }
        },
      },
    },
  },
});
