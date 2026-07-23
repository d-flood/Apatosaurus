import { defineConfig } from '@playwright/test';

const origin = 'http://127.0.0.1:13160';

export default defineConfig({
	webServer: {
		command: `DEV_BIND_HOST=127.0.0.1 DEV_PORT=13160 DEV_PUBLIC_ORIGIN=${origin} pnpm run dev`,
		url: origin,
		timeout: 120000,
		reuseExistingServer: false,
	},
	testDir: 'hmr',
	workers: 1,
	use: {
		baseURL: origin,
	},
});
