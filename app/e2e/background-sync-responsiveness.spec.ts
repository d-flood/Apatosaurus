import { expect, test } from '@playwright/test';
import { FakeGoogleSignIn } from './fake-google-sign-in';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

test('opening a project does not wait behind background cloud requests', async ({ page }) => {
	const harness = new FakeGoogleSignIn();
	await harness.install(page);
	await page.route(/^https:\/\/www\.googleapis\.com\/(upload\/)?drive\/v3\//, async route => {
		await new Promise(resolve => setTimeout(resolve, 300));
		await route.fallback();
	});
	await page.goto('/projects');
	await page.getByPlaceholder('New project name').fill('Latency Romans');
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page).toHaveURL(/\/projects\/[^/]+\/transcriptions$/);
	await page
		.getByRole('region', { name: 'Storage', exact: true })
		.getByRole('button', { name: 'Sign in with Google Drive' })
		.click();
	const dialog = page.getByRole('dialog', { name: 'Back up projects' });
	await expect(dialog).toBeVisible({ timeout: 30_000 });
	await dialog.getByRole('button', { name: 'Move', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 60_000 });

	await page.goto('/data');
	const project = page.getByRole('link', { name: /Latency Romans/ });
	await expect(project).toContainText('Synced', { timeout: 60_000 });
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	const started = Date.now();
	await project.click();
	await expect(page.getByTestId('project-location')).toBeVisible();

	expect(Date.now() - started).toBeLessThan(1_000);
});
