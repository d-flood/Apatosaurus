import path from 'node:path';
import { fileURLToPath } from 'node:url';
import staticAdapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';

const configDir = fileURLToPath(new URL('.', import.meta.url));

function workspacePath(...segments) {
	return path.resolve(configDir, '..', ...segments);
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: [vitePreprocess(), mdsvex()],
	kit: {
		adapter: staticAdapter({ fallback: '404.html' }),
		alias: {
			'collatex-tsport': workspacePath('collatex', 'collatex-tsport', 'src', 'index.ts'),
			'triiiceratops/plugins/annotation-editor': workspacePath(
				'triiiceratops',
				'src',
				'lib',
				'plugins',
				'annotation-editor',
				'index.ts'
			),
			'triiiceratops': workspacePath('triiiceratops', 'src', 'lib', 'index.ts'),
			$generated: 'src/generated',
		},
		prerender: {
			entries: ['*'],
		},
		serviceWorker: {
			register: false,
		},
		paths: {
			assets: '',
		},
	},
	extensions: ['.svelte', '.svx'],
};

export default config;
