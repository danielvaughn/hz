import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'electron-vite';

export default defineConfig({
	main: {},
	preload: {},
	renderer: {
		plugins: [svelte()]
	}
});
