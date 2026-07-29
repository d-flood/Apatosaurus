import { expect, test } from '@playwright/test';

test('boots and opens an unvisited route with the network offline', async ({ context, page }) => {
	await page.addInitScript(() => {
		const ready = new Promise<void>(resolve => {
			navigator.serviceWorker.addEventListener('message', event => {
				if (
					event.data?.type === 'OFFLINE_CACHE_PROGRESS' &&
					event.data.progress?.tier === 'routes' &&
					event.data.progress?.state === 'ready'
				) {
					resolve();
				}
			});
		});
		Object.assign(window, { routesWarmReady: ready });
	});
	await page.goto('/');
	await expect(page.getByRole('navigation')).toBeVisible();
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (navigator.serviceWorker.controller) return;
		await new Promise<void>(resolve => {
			navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
				once: true,
			});
		});
	});
	await page.evaluate(
		() => (window as unknown as { routesWarmReady: Promise<void> }).routesWarmReady
	);

	await context.setOffline(true);
	const offlineResponse = await page.reload();

	expect(offlineResponse).not.toBeNull();
	expect(offlineResponse!.status()).not.toBe(503);
	expect(offlineResponse!.headers()['content-type']).toContain('text/html');
	await expect(page.getByRole('navigation')).toBeVisible();
	await expect(page.locator('body')).not.toHaveText('Offline');

	await page.getByRole('link', { name: 'Data & Storage' }).click();
	await expect(page.getByRole('heading', { name: 'Data & Storage', level: 1 })).toBeVisible();
});
