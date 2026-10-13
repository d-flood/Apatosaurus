import { expect, test, type Page } from '@playwright/test';
import { FakeGoogleSignIn } from './fake-google-sign-in';

test.use({ serviceWorkers: 'block' });

function storageBanner(page: Page) {
	return page.getByRole('region', { name: 'Storage', exact: true });
}

async function createProject(page: Page, name: string): Promise<void> {
	await page.goto('/projects');
	await page.getByPlaceholder('New project name').fill(name);
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page).toHaveURL(/\/projects\/[^/]+\/transcriptions$/);
}

test('signing out while keeping projects shows an undismissable signed-out banner with Sign in', async ({
	page,
}) => {
	const harness = new FakeGoogleSignIn();
	await harness.install(page);
	await page.goto(`/auth/google/start?return_to=${encodeURIComponent('/projects')}`);
	await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
	await createProject(page, 'Banner Romans');
	await expect(storageBanner(page)).toHaveCount(0);

	await page.goto('/data');
	await page.getByRole('button', { name: 'Sign out', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Sign out' });
	await expect(dialog.getByRole('radio', { name: /Keep on this device/ })).toBeChecked();
	await dialog.getByRole('button', { name: 'Sign out' }).click();
	await expect(dialog).toBeHidden();

	await page.goto('/projects');
	const banner = storageBanner(page);
	await expect(banner).toContainText(
		'Google Drive is signed out · Changes stay here until you sign in'
	);
	await expect(banner.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);

	await banner.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
	await expect(page).toHaveURL(/\/projects$/);
	await expect(storageBanner(page)).toHaveCount(0);
});

test('on a phone the not-backed-up banner opens a sheet with both providers', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await createProject(page, 'Phone Romans');

	const banner = storageBanner(page);
	await expect(banner).toContainText('Not backed up');
	await expect(banner.getByRole('button', { name: /Sign in with/ })).toHaveCount(0);
	await banner.getByRole('button', { name: 'Back up' }).click();

	const sheet = page.getByRole('dialog', { name: 'Back up your projects' });
	await expect(sheet.getByRole('button', { name: 'Sign in with Google Drive' })).toBeVisible();
	await expect(sheet.getByRole('button', { name: 'Sign in with Dropbox' })).toBeVisible();
});
