import { expect, test } from '@playwright/test';

test('Vite HMR connects using the browser origin authority', async ({ page, baseURL }) => {
	if (!baseURL) throw new Error('HMR test requires a base URL');
	const expectedAuthority = new URL(baseURL).host;
	const hmrSocket = page.waitForEvent(
		'websocket',
		socket => new URL(socket.url()).host === expectedAuthority
	);

	await page.goto('/');

	await expect.poll(async () => (await hmrSocket).url()).toMatch(/^ws:\/\//);
});
