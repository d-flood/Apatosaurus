import { expect, test } from '@playwright/test';

test.describe('Registration Placeholder', () => {
	test('shows that registration is not wired up yet', async ({ page }) => {
		await page.goto('/accounts/register');

		await expect(page.getByRole('heading', { name: 'Register' })).toBeVisible();
		await expect(page.getByText(/registration is not wired up yet/i)).toBeVisible();
	});

	test('does not navigate away when the placeholder form is submitted', async ({ page }) => {
		await page.goto('/accounts/register');

		await page.fill('input[name="email"]', 'contributor@example.com');
		await page.fill('input[name="password"]', 'longenoughpassword');
		await page.fill('input[name="confirmPassword"]', 'longenoughpassword');
		await page.click('button[type="submit"]');

		await expect(page).toHaveURL(/\/accounts\/register$/);
		await expect(page.getByText(/non-functional placeholder/i)).toBeVisible();
	});

	test('shows password mismatch feedback before submission', async ({ page }) => {
		await page.goto('/accounts/register');

		const confirmPassword = page.locator('input[name="confirmPassword"]');
		await page.fill('input[name="password"]', 'longenoughpassword');
		await confirmPassword.fill('differentpassword');

		await expect(confirmPassword).toHaveClass(/input-error/);
	});
});
