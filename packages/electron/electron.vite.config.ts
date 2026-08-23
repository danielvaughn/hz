import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'electron-vite';

export default defineConfig({
	main: {},
	preload: {
		build: {
			rollupOptions: {
				output: { format: 'cjs' }
			}
		}
	},
	renderer: {
		plugins: [svelte()]
	}
});
