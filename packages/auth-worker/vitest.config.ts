import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			miniflare: {
				bindings: {
					APP_ORIGIN: 'https://app.example',
					DROPBOX_CLIENT_ID: 'dropbox-client',
					DROPBOX_CLIENT_SECRET: 'dropbox-secret',
					GOOGLE_CLIENT_ID: 'google-client',
					GOOGLE_CLIENT_SECRET: 'google-secret',
					COOKIE_SECRET: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
				},
			},
		}),
	],
	test: {
		expect: { requireAssertions: true },
	},
});
