import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import devtoolsJson from 'vite-plugin-devtools-json';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(__dirname, '..');

function workspacePath(...segments: string[]) {
	return path.resolve(repoRoot, ...segments);
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
	server: {
		host: '0.0.0.0',
		port: 3160,
		fs: {
			allow: [repoRoot],
		},
	},
	optimizeDeps: {
		exclude: ['@sqlite.org/sqlite-wasm'],
		include: [
			'@tiptap/core',
			'@tiptap/extension-bubble-menu',
			'@tiptap/extension-text',
			'@tiptap/extensions',
		],
		esbuildOptions: {
			define: {
				global: 'globalThis',
			},
		},
	},
	resolve: {
		alias: [
			{ find: 'events', replacement: 'events' },
			{
				find: '@djazzkit/core/fields',
				replacement: workspacePath('djazzkit', 'packages', 'core', 'src', 'query', 'fields.ts'),
			},
			{
				find: '@djazzkit/core/',
				replacement: workspacePath('djazzkit', 'packages', 'core', 'src') + '/',
			},
			{
				find: '@djazzkit/core',
				replacement: workspacePath('djazzkit', 'packages', 'core', 'src', 'index.ts'),
			},
			{
				find: '@djazzkit/svelte/',
				replacement: workspacePath('djazzkit', 'packages', 'svelte', 'src') + '/',
			},
			{
				find: '@djazzkit/svelte',
				replacement: workspacePath('djazzkit', 'packages', 'svelte', 'src', 'index.ts'),
			},
			{
				find: 'collatex-tsport',
				replacement: workspacePath('collatex', 'collatex-tsport', 'src', 'index.ts'),
			},
			{
				find: 'triiiceratops/plugins/annotation-editor',
				replacement: workspacePath(
					'triiiceratops',
					'src',
					'lib',
					'plugins',
					'annotation-editor',
					'index.ts',
				),
			},
			{
				find: 'triiiceratops',
				replacement: workspacePath('triiiceratops', 'src', 'lib', 'index.ts'),
			},
		],
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					environment: 'browser',
					browser: {
						enabled: true,
						provider: 'playwright',
						instances: [{ browser: 'chromium' }],
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					setupFiles: ['./vitest-setup-client.ts'],
				},
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
				},
			},
		],
	},
});
