import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const base = process.env.BASE_PATH ?? '';
export default {
  preprocess: vitePreprocess(),
  kit: {
    // strict: false lets a route opt out of prerendering and simply not be
    // emitted — which is how /draw stays out of the built site. The adapter's
    // own error text describes this exact use. It does weaken a safety net for
    // OTHER routes, so build-output.test.ts asserts what the build contains.
    adapter: adapter({ fallback: undefined, strict: false }),
    paths: { base },
    prerender: { handleHttpError: 'fail' }
  }
};
