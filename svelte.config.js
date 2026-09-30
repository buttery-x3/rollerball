import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    paths: { base: /** @type {'' | `/${string}`} */ (process.env.VITE_BASE_PATH ?? '') }
  }
};

export default config;
