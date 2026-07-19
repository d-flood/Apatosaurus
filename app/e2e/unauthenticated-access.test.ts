import { expect, test } from '@playwright/test';

test.describe('Unauthenticated Access', () => {
	test('allows access to the root page without authentication', async ({ page }) => {
		await page.goto('/');

		await expect(page).toHaveURL('/');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	});

	test('allows access to the project picker without authentication', async ({ page }) => {
		await page.goto('/projects');

		await expect(page).not.toHaveURL(/\/accounts\/login/);
		await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
	});

	test('does not redirect to login when visiting the collation route', async ({ page }) => {
		await page.goto('/collation');

		await expect(page).not.toHaveURL(/\/accounts\/login/);
	});

	test('shows public navigation links instead of a login button', async ({ page }) => {
		await page.goto('/');
		const navbar = page.getByRole('navigation', { name: 'Primary' });

		await expect(
			navbar.getByRole('link', { name: 'Transcriptions', exact: true })
		).toHaveAttribute('href', '/projects');
		await expect(navbar.getByRole('link', { name: 'Collations', exact: true })).toHaveAttribute(
			'href',
			'/projects'
		);
		await expect(page.locator('a[href="/accounts/login"]')).toHaveCount(0);
	});
});
