import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const base = process.env.BASE_PATH ?? '';
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ fallback: undefined }),
    paths: { base },
    prerender: { handleHttpError: 'fail' }
  }
};
