import { expect, test } from '@playwright/test';
import { FakeGoogleSignIn } from './fake-google-sign-in';

test.use({ serviceWorkers: 'block' });

test('signing in with Google creates the personal location and its Drive folder', async ({
	page,
}) => {
	const harness = new FakeGoogleSignIn();
	await harness.install(page);
	await page.goto('/data');
	await page.getByRole('button', { name: 'Sign in with Google' }).click();

	const locations = page.locator('section', {
		has: page.getByRole('heading', { name: 'Locations' }),
	});
	await expect(locations.getByText('Google Drive/Apatosaurus', { exact: true })).toBeVisible();
	await page.locator('.navbar-end .dropdown [role="button"]').click();
	await expect(page.getByText('Google Drive connected', { exact: true })).toBeVisible();
	expect(harness.drive.findByName('Apatosaurus')).toBeDefined();
});

test('a cancelled Google sign-in is reported on Data & Storage', async ({ page }) => {
	const harness = new FakeGoogleSignIn();
	await harness.install(page);
	harness.cancelNextSignIn();
	await page.goto('/data');
	await page.getByRole('button', { name: 'Sign in with Google' }).click();

	await expect(page.getByText('Sign-in was cancelled.')).toBeVisible();
});
