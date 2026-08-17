import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { routeLinesPlugin } from './vite-plugin-route-lines';

export default defineConfig({
  plugins: [sveltekit(), routeLinesPlugin()],
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest-setup.ts'],
    globals: true,
    include: ['src/**/*.{test,spec}.ts', 'scripts/**/*.{test,spec}.ts', '*.test.ts']
  }
});
