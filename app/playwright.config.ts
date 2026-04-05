import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'bun run build && bunx vite preview --host 127.0.0.1 --port 4173',
		port: 4173,
		timeout: 120000,
		reuseExistingServer: !process.env.CI,
	},
	testDir: 'e2e'
});
