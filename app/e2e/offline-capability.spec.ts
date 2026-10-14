import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
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
});

async function waitForOfflineCache(page: Page): Promise<void> {
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
}

test('boots and opens an unvisited route with the network offline', async ({ context, page }) => {
	await page.goto('/');
	await expect(page.getByRole('navigation')).toBeVisible();
	await waitForOfflineCache(page);

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

test('edits a transcription offline with a notice that clears online', async ({
	context,
	page,
}) => {
	test.setTimeout(120_000);
	const offlineNotice = page.getByText("You're offline. Changes are saved on this device.");

	await page.goto('/projects');
	await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
	await page.getByPlaceholder('New project name').fill('Offline Project');
	await page.getByPlaceholder('New project name').press('Enter');
	await expect(page).toHaveURL(/\/projects\/[^/]+\/transcriptions$/);
	await expect(page.getByRole('heading', { name: 'Offline Project' })).toBeVisible();
	await page.getByRole('link', { name: 'New Transcription' }).click();
	await page.locator('input[name="title"]').fill('Offline Witness');
	await page.locator('input[name="siglum"]').fill('OW');
	await page.locator('input[name="transcriber"]').fill('E2E Editor');
	await page.locator('input[name="repository"]').fill('E2E Library');
	await page.locator('input[name="settlement"]').fill('Test City');
	await page.locator('input[name="language"]').fill('Greek');
	await page.getByRole('button', { name: 'Create Transcription' }).click();
	await expect(page.getByRole('heading', { name: 'Offline Witness' })).toBeVisible({
		timeout: 30_000,
	});
	await expect(offlineNotice).toBeHidden();
	await page.goto('/');
	await waitForOfflineCache(page);

	await context.setOffline(true);
	await page.reload();
	await page
		.getByRole('list', { name: 'Recent documents' })
		.getByRole('listitem')
		.filter({ hasText: 'Offline Witness' })
		.getByRole('link', { name: 'Open' })
		.click();
	await expect(page.getByRole('heading', { name: 'Offline Witness', level: 1 })).toBeVisible();
	await expect(offlineNotice).toBeVisible();

	await page.locator('[aria-label="Insert Page"]').click();
	const popover = page.locator('[id$="popover-insert-page"]');
	await popover.locator('input[placeholder="e.g. 123r"]').fill('001r');
	await popover.getByRole('button', { name: 'Standard Page' }).click();
	await expect(page.locator('[data-page-name="001r"]')).toBeVisible();
	await expect(page.getByText(/^Saved locally/)).toBeVisible();
	await expect(offlineNotice).toBeVisible();

	await context.setOffline(false);
	await expect(offlineNotice).toBeHidden();
});
