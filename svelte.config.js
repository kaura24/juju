/** File: svelte.config.js */
import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			// Include scripts folder in serverless functions
			external: [],
			// This ensures scripts folder is copied to build output
			isr: {
				expiration: false
			}
		})
	}
};

export default config;
