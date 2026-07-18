import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command:
			'VITE_E2E_SHARED_FOLDER=1 bun run build && bunx vite preview --host 127.0.0.1 --port 4173',
		port: 4173,
		timeout: 120000,
		reuseExistingServer: !process.env.CI,
	},
	testDir: 'e2e',
	workers: 1,
	use: {
		baseURL: 'http://localhost:4173',
	},
});
