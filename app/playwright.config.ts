import { defineConfig } from '@playwright/test';
import { WELCOME_SKIPPED_STORAGE_KEY } from './src/lib/shell/welcome-gate';

const port = Number(process.env.E2E_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	webServer: {
		command: `VITE_E2E_SHARED_FOLDER=1 pnpm run build && pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
		port,
		timeout: 120000,
		reuseExistingServer: false,
	},
	testDir: 'e2e',
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	use: {
		baseURL,
		storageState: {
			cookies: [],
			origins: [
				{
					origin: baseURL,
					localStorage: [{ name: WELCOME_SKIPPED_STORAGE_KEY, value: 'true' }],
				},
			],
		},
	},
});
