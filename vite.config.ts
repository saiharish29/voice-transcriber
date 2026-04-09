import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Pure static SPA — no backend proxy needed.
// API key lives in localStorage and is sent directly to Google's Gemini API
// from the browser. Our server never sees or stores it.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split the large Gemini SDK into its own chunk so the main bundle stays small.
          // Browsers can cache this separately — it won't change with every app deploy.
          'vendor-gemini': ['@google/genai'],
          'vendor-react':  ['react', 'react-dom'],
        },
      },
    },
  },
});
