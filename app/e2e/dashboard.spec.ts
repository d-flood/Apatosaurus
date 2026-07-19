import { expect, test, type Page } from '@playwright/test';

test.setTimeout(120_000);

test('Continue resumes a collation at its current phase and About preserves the feature overview', async ({
	page,
}) => {
	const projectId = await createProject(page, 'Dashboard Romans');
	await importRomansTranscription(page, projectId);
	const collationPath = await createRomansCollation(page, projectId);

	await page.goto('/');
	const collationRow = page.getByRole('listitem').filter({ hasText: 'Collation Rom' });
	await expect(collationRow).toContainText('Collation');
	await expect(collationRow).toContainText('Dashboard Romans');
	await collationRow.getByRole('link', { name: 'Open' }).click();
	await expect(page).toHaveURL(collationPath);

	await page.goto('/about');
	await expect(page.getByRole('heading', { name: 'Transcription Editor' })).toBeVisible();
	await expect(page.getByText('Automated alignment with interactive fine-tuning.')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Local and Offline First' })).toBeVisible();
});

test('attention opens Data & Storage and Start something creates in its named project', async ({
	page,
}) => {
	const projectId = await createProject(page, 'Dashboard Creation');
	await page.goto('/');

	await page.getByRole('link', { name: 'Review backup options' }).click();
	await expect(page).toHaveURL('/data');

	await page.goto('/');
	await page.getByRole('link', { name: 'New Transcription in Dashboard Creation' }).click();
	await expect(page.getByRole('combobox', { name: 'Project*' })).toHaveValue(projectId);
	await fillTranscriptionForm(page, 'Dashboard Witness', 'DASH');
	await page.getByRole('button', { name: 'Create Transcription' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard Witness' })).toBeVisible({
		timeout: 30_000,
	});

	await page.goto(`/projects/${projectId}/transcriptions`);
	await expect(page.getByText('Dashboard Witness', { exact: true }).first()).toBeVisible();
});

test('a fresh profile shows only the first-project welcome card', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('link', { name: 'Create your first project' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Continue where you left off' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Needs attention' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Start something' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'About Apatosaurus' })).toHaveCount(0);
});

async function createProject(page: Page, name: string): Promise<string> {
	await page.goto('/projects');
	await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
	const input = page.getByPlaceholder('New project name');
	await input.fill(name);
	await input.press('Enter');
	await expect(page).toHaveURL(/\/projects\/[^/]+\/transcriptions$/);
	await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
	const match = new URL(page.url()).pathname.match(/^\/projects\/([^/]+)\/transcriptions$/);
	if (!match?.[1]) throw new Error(`Project URL did not identify ${name}`);
	return match[1];
}

async function importRomansTranscription(page: Page, projectId: string): Promise<void> {
	await page.goto(`/transcription/igntp?projectId=${projectId}`);
	await page.getByRole('combobox', { name: 'Import into project' }).selectOption(projectId);
	await page
		.getByRole('searchbox', { name: 'Search provided transcriptions' })
		.fill('NT_GRC_459_Rom.xml');
	await page.getByRole('checkbox', { name: 'NT_GRC_459_Rom.xml' }).check();
	await page.getByRole('button', { name: 'Import Selected (1)' }).click();
	await expect(page.getByText('Imported GA 459.').last()).toBeVisible({ timeout: 60_000 });
}

async function createRomansCollation(page: Page, projectId: string): Promise<string> {
	await page.goto(`/collation/new?projectId=${projectId}`);
	await expect(page.getByRole('heading', { name: 'Verse Selector' })).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.getByText('GA 459', { exact: true }).first()).toBeVisible({
		timeout: 30_000,
	});
	await page.getByRole('button', { name: /^Rom / }).first().click();
	const proceed = page.getByRole('button', { name: 'Proceed to Alignment' });
	await expect(proceed).toBeEnabled({ timeout: 30_000 });
	await proceed.click();
	await expect(page).toHaveURL(/\/collation\/[^/]+\/alignment$/);
	return new URL(page.url()).pathname;
}

async function fillTranscriptionForm(page: Page, title: string, siglum: string): Promise<void> {
	await page.locator('input[name="title"]').fill(title);
	await page.locator('input[name="siglum"]').fill(siglum);
	await page.locator('input[name="transcriber"]').fill('E2E Editor');
	await page.locator('input[name="repository"]').fill('E2E Library');
	await page.locator('input[name="settlement"]').fill('Test City');
	await page.locator('input[name="language"]').fill('Greek');
}
