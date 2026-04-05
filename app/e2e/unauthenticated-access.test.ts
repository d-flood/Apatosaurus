import { expect, test } from '@playwright/test';

test.describe('Unauthenticated Access', () => {
	test('allows access to the root page without authentication', async ({ page }) => {
		await page.goto('/');

		await expect(page).toHaveURL('/');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	});

	test('allows access to the transcription listing without authentication', async ({ page }) => {
		await page.goto('/transcription');

		await expect(page).not.toHaveURL(/\/accounts\/login/);
		await expect(page.getByRole('heading', { name: /transcriptions/i })).toBeVisible();
	});

	test('does not redirect to login when visiting the collation route', async ({ page }) => {
		await page.goto('/collation');

		await expect(page).not.toHaveURL(/\/accounts\/login/);
	});

	test('shows public navigation links instead of a login button', async ({ page }) => {
		await page.goto('/');

		await expect(page.locator('a[href="/transcription"]').last()).toBeVisible();
		await expect(page.locator('a[href="/projects"]').last()).toBeVisible();
		await expect(page.locator('a[href="/accounts/login"]')).toHaveCount(0);
	});
});
