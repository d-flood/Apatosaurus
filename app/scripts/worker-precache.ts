import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export function workerPrecache() {
	const shell = new Set<string>();
	let root: string;
	let clientBuild = false;

	function writeManifest(build: string[], shell: string[]) {
		const directory = path.join(root, '.svelte-kit');
		mkdirSync(directory, { recursive: true });
		writeFileSync(
			path.join(directory, 'worker-precache.js'),
			`export const build = ${JSON.stringify(build)};\nexport const shell = ${JSON.stringify(shell)};\n`
		);
	}

	const workers = (): Plugin[] => [
		{
			name: 'db-worker-precache',
			generateBundle(_options, bundle) {
				const isDbWorker = Object.values(bundle).some(
					entry =>
						entry.type === 'chunk' && entry.facadeModuleId?.endsWith('/db.worker.ts')
				);
				if (isDbWorker) {
					for (const file of Object.keys(bundle)) shell.add(`/${file}`);
				}
			},
		},
	];

	const plugin: Plugin = {
		name: 'worker-precache',
		apply: 'build',
		configResolved(config) {
			root = config.root;
			clientBuild = !config.build.ssr;
		},
		writeBundle(_options, bundle) {
			if (!clientBuild) return;
			const build = Object.keys(bundle)
				.filter(file => file.startsWith('_app/immutable/workers/'))
				.map(file => `/${file}`)
				.sort();
			writeManifest(build, [...shell].sort());
		},
	};

	return { plugin, workers };
}
