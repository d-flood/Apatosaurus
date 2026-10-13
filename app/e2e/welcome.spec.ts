import { expect, test } from '@playwright/test';
import { FakeGoogleSignIn } from './fake-google-sign-in';

test.use({ serviceWorkers: 'block', storageState: { cookies: [], origins: [] } });

const HEADLINE = 'Keep your work safe on every device';

async function apatosaurusFolderNames(harness: FakeGoogleSignIn): Promise<string[]> {
	const root = harness.drive.findByName('Apatosaurus');
	if (!root) return [];
	const params = new URLSearchParams({
		q: `'${root.id}' in parents and trashed = false`,
		pageSize: '100',
		supportsAllDrives: 'true',
	});
	const response = await harness.drive.fetch(
		`https://www.googleapis.com/drive/v3/files?${params}`,
		{ headers: { Authorization: `Bearer ${await harness.drive.tokens.getAccessToken()}` } }
	);
	const { files } = (await response.json()) as { files: { name: string }[] };
	return files.map(file => file.name);
}

test('a fresh device opening the Dashboard or Projects lands on the welcome page, but About does not', async ({
	page,
}) => {
	for (const path of ['/', '/projects']) {
		await page.goto(path);
		await expect(page).toHaveURL(/\/welcome$/);
		await expect(page.getByRole('heading', { name: HEADLINE, level: 1 })).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
	}

	await page.goto('/about');
	await expect(page.getByRole('heading', { name: 'Apatosaurus', level: 1 })).toBeVisible();
	await expect(page).toHaveURL(/\/about$/);
});

test('continuing without signing in reaches Projects, and the Dashboard then opens', async ({
	page,
}) => {
	await page.goto('/');
	await page.getByRole('link', { name: 'Continue without signing in' }).click();
	await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
	await expect(page).toHaveURL(/\/projects$/);

	await page.goto('/');
	await expect(page.getByRole('link', { name: 'Create your first project' })).toBeVisible();
	await expect(page.getByRole('heading', { name: HEADLINE })).toHaveCount(0);
	await expect(page).not.toHaveURL(/\/welcome$/);
});

test('signing in with Google Drive returns to Projects, where a new project lands in Drive', async ({
	page,
}) => {
	const harness = new FakeGoogleSignIn();
	await harness.install(page);
	await page.goto('/');
	await page.getByRole('button', { name: 'Sign in with Google Drive' }).click();

	await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
	await expect(page).toHaveURL(/\/projects$/);
	await page.locator('.navbar-end .dropdown [role="button"]').click();
	await expect(page.getByText('Google Drive connected', { exact: true })).toBeVisible();

	await page.getByPlaceholder('New project name').fill('Welcome Romans');
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page).toHaveURL(/\/projects\/[^/]+\/transcriptions$/);
	await expect
		.poll(() => apatosaurusFolderNames(harness), { timeout: 30_000 })
		.toContainEqual(expect.stringMatching(/^welcome-romans-/));
});

test('offline, the sign-in buttons are disabled and continuing without signing in still works', async ({
	page,
	context,
}) => {
	await page.goto('/projects');
	await expect(page.getByRole('heading', { name: HEADLINE, level: 1 })).toBeVisible();
	await context.setOffline(true);

	await expect(page.getByRole('button', { name: 'Sign in with Google Drive' })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Sign in with Dropbox' })).toBeDisabled();
	await expect(page.getByText('Connect to the internet to sign in')).toBeVisible();
	await page.getByRole('link', { name: 'Continue without signing in' }).click();
	await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
});

test('on a phone the sign-in buttons stack full width above the skip link', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/welcome');
	const google = page.getByRole('button', { name: 'Sign in with Google Drive' });
	const dropbox = page.getByRole('button', { name: 'Sign in with Dropbox' });
	const skip = page.getByRole('link', { name: 'Continue without signing in' });
	const buttonGroup = google.locator('xpath=..');

	await expect
		.poll(async () => {
			const [group, first, second, link] = await Promise.all([
				buttonGroup.boundingBox(),
				google.boundingBox(),
				dropbox.boundingBox(),
				skip.boundingBox(),
			]);
			if (!group || !first || !second || !link) return null;
			return {
				firstFullWidth: first.x === group.x && first.width === group.width,
				secondFullWidth: second.x === group.x && second.width === group.width,
				stacked: second.y >= first.y + first.height,
				skipBelow: link.y >= second.y + second.height,
			};
		})
		.toEqual({ firstFullWidth: true, secondFullWidth: true, stacked: true, skipBelow: true });
});
