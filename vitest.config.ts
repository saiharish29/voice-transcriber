import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    // forks pool: uses separate child processes instead of worker threads.
    // Required on Node 18 — the default threads pool hits memory limits
    // inside jsdom environments.  On Node 20+ you can remove this.
    pool: 'forks',
    // Isolate each test file so localStorage state doesn't bleed between files
    isolate: true,
  },
});
