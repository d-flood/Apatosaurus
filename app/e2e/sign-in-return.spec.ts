import { expect, test } from '@playwright/test';
import { FakeGoogleSignIn } from './fake-google-sign-in';

test.use({ serviceWorkers: 'block' });

const START_FROM_PROJECTS = `/auth/google/start?return_to=${encodeURIComponent('/projects')}`;

test('signing in from Projects returns to Projects with the account connected', async ({
	page,
}) => {
	const harness = new FakeGoogleSignIn();
	await harness.install(page);
	await page.goto(START_FROM_PROJECTS);

	await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
	await page.locator('.navbar-end .dropdown [role="button"]').click();
	await expect(page.getByText('Google Drive connected', { exact: true })).toBeVisible();
	await expect(page).toHaveURL(/\/projects$/);
	expect(harness.drive.findByName('Apatosaurus')).toBeDefined();
});

test('a cancelled sign-in started on Projects is reported on Projects', async ({ page }) => {
	const harness = new FakeGoogleSignIn();
	await harness.install(page);
	harness.cancelNextSignIn();
	await page.goto(START_FROM_PROJECTS);

	await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
	const alert = page.getByRole('alert').filter({ hasText: 'Sign-in was cancelled.' });
	await expect(alert).toBeVisible();
	await expect(page).toHaveURL(/\/projects$/);
	await alert.getByRole('button', { name: 'Dismiss' }).click();
	await expect(alert).toBeHidden();
});

test('a sign-in error offers another sign-in on the landing page', async ({ page }) => {
	const harness = new FakeGoogleSignIn();
	await harness.install(page);
	harness.cancelNextSignIn();
	await page.goto(`/auth/google/start?return_to=${encodeURIComponent('/about')}`);
	const alert = page.getByRole('alert').filter({ hasText: 'Sign-in was cancelled.' });
	await expect(alert).toBeVisible();
	await expect(page).toHaveURL(/\/about$/);
	await alert.getByRole('button', { name: 'Sign in with Google Drive' }).click();
	await expect(alert).toBeHidden();
	await expect(page).toHaveURL(/\/about$/);
	await page.locator('.navbar-end .dropdown [role="button"]').click();
	await expect(page.getByText('Google Drive connected', { exact: true })).toBeVisible();
});
