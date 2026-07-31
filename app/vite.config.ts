import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import devtoolsJson from 'vite-plugin-devtools-json';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(__dirname, '..');

function workspacePath(...segments: string[]) {
	return path.resolve(repoRoot, ...segments);
}

type DevelopmentEnvironment = Readonly<Record<string, string | undefined>>;

export function developmentServer(environment: DevelopmentEnvironment = process.env) {
	const portText = environment.DEV_PORT ?? '3160';
	if (!/^\d+$/.test(portText)) {
		throw new Error(`DEV_PORT must be an integer between 1 and 65535, received ${portText}`);
	}
	const port = Number(portText);
	if (port < 1 || port > 65535) {
		throw new Error(`DEV_PORT must be an integer between 1 and 65535, received ${portText}`);
	}

	const originText = environment.DEV_PUBLIC_ORIGIN ?? `http://localhost:${port}`;
	let origin: URL;
	try {
		origin = new URL(originText);
	} catch {
		throw new Error(
			`DEV_PUBLIC_ORIGIN must be an HTTP or HTTPS origin, received ${originText}`
		);
	}
	if (
		(origin.protocol !== 'http:' && origin.protocol !== 'https:') ||
		origin.username !== '' ||
		origin.password !== '' ||
		origin.pathname !== '/' ||
		origin.search !== '' ||
		origin.hash !== ''
	) {
		throw new Error(
			`DEV_PUBLIC_ORIGIN must be an HTTP or HTTPS origin, received ${originText}`
		);
	}

	return {
		host: environment.DEV_BIND_HOST || '127.0.0.1',
		port,
		strictPort: true,
		allowedHosts: [origin.hostname],
	};
}

// The browser test project binds a TCP port for its Chromium runner. Vitest
// defaults to 63315 with strict binding, so two concurrent `--project client`
// runs collide and the loser reports "no tests" rather than a real failure.
// Unpinned runs therefore fall back to the next free port; set
// VITEST_BROWSER_PORT to pin one and fail loudly if it is taken.
export function browserTestServer(environment: DevelopmentEnvironment = process.env) {
	const portText = environment.VITEST_BROWSER_PORT;
	if (portText === undefined || portText === '') {
		return { port: 63315, strictPort: false };
	}
	if (!/^\d+$/.test(portText)) {
		throw new Error(
			`VITEST_BROWSER_PORT must be an integer between 1 and 65535, received ${portText}`
		);
	}
	const port = Number(portText);
	if (port < 1 || port > 65535) {
		throw new Error(
			`VITEST_BROWSER_PORT must be an integer between 1 and 65535, received ${portText}`
		);
	}
	return { port, strictPort: true };
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
	server: {
		...developmentServer(),
		fs: {
			allow: [repoRoot],
		},
	},
	optimizeDeps: {
		exclude: ['@sqlite.org/sqlite-wasm'],
		// Pre-bundle every dep the app and browser test suite touch. When Vite
		// discovers a dep mid-run it re-optimizes and reloads, which aborts
		// in-flight dynamic imports in the Chromium test runner ("Failed to fetch
		// dynamically imported module"). Regenerate from
		// node_modules/.vite/vitest/*/deps/_metadata.json if a new dep flakes.
		include: [
			'@annotorious/openseadragon',
			'@triiiceratops/plugin-annotation-editor',
			'@triiiceratops/plugin-sdk',
			'@floating-ui/dom',
			'@journeyapps/wa-sqlite',
			'@journeyapps/wa-sqlite/dist/wa-sqlite.mjs',
			'@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js',
			'@tiptap/core',
			'@tiptap/extension-bubble-menu',
			'@tiptap/extension-history',
			'@tiptap/extension-text',
			'@tiptap/extensions',
			'@tiptap/pm/model',
			'@tiptap/pm/state',
			'@tiptap/pm/view',
			'devalue',
			'dompurify',
			'esm-env',
			'kysely',
			'lucide-svelte',
			'manifesto.js',
			'manifesto.js/dist-esmodule/index.js',
			'nanoid',
			'openseadragon',
			'phosphor-svelte/lib/ArrowClockwise',
			'phosphor-svelte/lib/ArrowCounterClockwise',
			'phosphor-svelte/lib/ArrowLeft',
			'phosphor-svelte/lib/ArrowRight',
			'phosphor-svelte/lib/ArrowUDownRight',
			'phosphor-svelte/lib/ArrowUUpLeft',
			'phosphor-svelte/lib/ArrowUUpRight',
			'phosphor-svelte/lib/ArrowsClockwise',
			'phosphor-svelte/lib/ArrowsInSimple',
			'phosphor-svelte/lib/ArrowsLeftRight',
			'phosphor-svelte/lib/ArrowsOutSimple',
			'phosphor-svelte/lib/ArrowsOutSimpleIcon',
			'phosphor-svelte/lib/Bell',
			'phosphor-svelte/lib/BookOpen',
			'phosphor-svelte/lib/BookOpenText',
			'phosphor-svelte/lib/BookmarkSimple',
			'phosphor-svelte/lib/BracketsRound',
			'phosphor-svelte/lib/BracketsSquare',
			'phosphor-svelte/lib/CaretDown',
			'phosphor-svelte/lib/CaretLeft',
			'phosphor-svelte/lib/CaretRight',
			'phosphor-svelte/lib/CaretUp',
			'phosphor-svelte/lib/ChatCenteredText',
			'phosphor-svelte/lib/Check',
			'phosphor-svelte/lib/CheckCircle',
			'phosphor-svelte/lib/CircleNotch',
			'phosphor-svelte/lib/CloudArrowUp',
			'phosphor-svelte/lib/CornersIn',
			'phosphor-svelte/lib/CornersOut',
			'phosphor-svelte/lib/Crosshair',
			'phosphor-svelte/lib/Eye',
			'phosphor-svelte/lib/EyeSlash',
			'phosphor-svelte/lib/File',
			'phosphor-svelte/lib/FileArrowDownIcon',
			'phosphor-svelte/lib/FlagBanner',
			'phosphor-svelte/lib/FloppyDisk',
			'phosphor-svelte/lib/Folder',
			'phosphor-svelte/lib/FolderOpen',
			'phosphor-svelte/lib/GitCommit',
			'phosphor-svelte/lib/HardDrives',
			'phosphor-svelte/lib/Hash',
			'phosphor-svelte/lib/Image',
			'phosphor-svelte/lib/ImageBroken',
			'phosphor-svelte/lib/Info',
			'phosphor-svelte/lib/Lightning',
			'phosphor-svelte/lib/LinkBreak',
			'phosphor-svelte/lib/LinkSimple',
			'phosphor-svelte/lib/List',
			'phosphor-svelte/lib/ListBullets',
			'phosphor-svelte/lib/ListDashes',
			'phosphor-svelte/lib/ListNumbers',
			'phosphor-svelte/lib/Lock',
			'phosphor-svelte/lib/MagnifyingGlass',
			'phosphor-svelte/lib/MagnifyingGlassMinus',
			'phosphor-svelte/lib/MagnifyingGlassPlus',
			'phosphor-svelte/lib/Moon',
			'phosphor-svelte/lib/Note',
			'phosphor-svelte/lib/Paragraph',
			'phosphor-svelte/lib/PencilSimple',
			'phosphor-svelte/lib/Plus',
			'phosphor-svelte/lib/Polygon',
			'phosphor-svelte/lib/Quotes',
			'phosphor-svelte/lib/Rectangle',
			'phosphor-svelte/lib/Scroll',
			'phosphor-svelte/lib/Sidebar',
			'phosphor-svelte/lib/Slideshow',
			'phosphor-svelte/lib/Stack',
			'phosphor-svelte/lib/Sun',
			'phosphor-svelte/lib/Table',
			'phosphor-svelte/lib/Target',
			'phosphor-svelte/lib/TextColumns',
			'phosphor-svelte/lib/TextIndent',
			'phosphor-svelte/lib/ToggleLeft',
			'phosphor-svelte/lib/ToggleRight',
			'phosphor-svelte/lib/Trash',
			'phosphor-svelte/lib/TreeStructure',
			'phosphor-svelte/lib/UserPlus',
			'phosphor-svelte/lib/Warning',
			'phosphor-svelte/lib/WarningCircle',
			'phosphor-svelte/lib/WifiSlash',
			'phosphor-svelte/lib/X',
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
				find: 'collatex-tsport',
				replacement: workspacePath('collatex', 'collatex-tsport', 'src', 'index.ts'),
			},
		],
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				// Test-only deps that would otherwise be discovered (and trigger a
				// mid-run reload) the first time a spec module loads in the browser.
				optimizeDeps: {
					include: [
						'chai',
						'expect-type',
						'@vitest/browser > @testing-library/dom',
						'@vitest/browser > @testing-library/user-event',
						'vitest > @vitest/runner > strip-literal',
						'vitest > @vitest/snapshot > magic-string',
						'vitest > @vitest/utils > loupe',
						'vitest > chai',
						'vitest > chai > loupe',
						'vitest > expect-type',
					],
				},
				test: {
					name: 'client',
					environment: 'browser',
					browser: {
						enabled: true,
						provider: 'playwright',
						instances: [{ browser: 'chromium' }],
						api: browserTestServer(),
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
					include: ['src/**/*.{test,spec}.{js,ts}', 'vite.config.spec.ts'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
				},
			},
		],
	},
});
