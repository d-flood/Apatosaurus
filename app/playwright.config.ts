import { defineConfig } from '@playwright/test';
import { WELCOME_SKIPPED_STORAGE_KEY } from './src/lib/shell/welcome-gate';

const baseURL = 'http://localhost:4173';

export default defineConfig({
	webServer: {
		command:
			'VITE_E2E_SHARED_FOLDER=1 pnpm run build && pnpm exec vite preview --host 127.0.0.1 --port 4173',
		port: 4173,
		timeout: 120000,
		reuseExistingServer: !process.env.CI,
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
