import { expect, test, type Page } from '@playwright/test';

test.setTimeout(120_000);

test('bare creation pages use the last-opened project and honor a changed destination', async ({
	page,
}) => {
	await createProject(page, 'Creation Project One');
	const lastOpenedProjectId = await createProject(page, 'Creation Project Two');
	const switchedProjectId = await createProject(page, 'Creation Project Three');
	await page.evaluate(projectId => {
		localStorage.setItem('lastOpenedProjectId', projectId);
	}, lastOpenedProjectId);

	await page.goto('/transcription/new');
	const transcriptionProject = page.getByRole('combobox', { name: 'Project*' });
	await expect(transcriptionProject).toHaveValue(lastOpenedProjectId);
	await transcriptionProject.selectOption(switchedProjectId);
	await fillTranscriptionForm(page, 'Switched Project Witness', 'SPW');
	await page.getByRole('button', { name: 'Create Transcription' }).click();
	await expect(page.getByRole('heading', { name: 'Switched Project Witness' })).toBeVisible({
		timeout: 30_000,
	});

	await page.goto('/projects');
	await page.getByRole('button', { name: /Creation Project Three/ }).click();
	await expect(page.getByText('Switched Project Witness', { exact: true }).first()).toBeVisible();

	await page.goto('/collation/new');
	await expect(page.getByRole('combobox', { name: 'Project*' })).toHaveValue(lastOpenedProjectId);
});

test('first creation with no projects still uses Default', async ({ page }) => {
	await page.goto('/transcription/new');
	await expect(page.getByRole('combobox', { name: 'Project*' })).toHaveText(/Default/);
	await fillTranscriptionForm(page, 'First Run Witness', 'FRW');
	await page.getByRole('button', { name: 'Create Transcription' }).click();
	await expect(page.getByRole('heading', { name: 'First Run Witness' })).toBeVisible({
		timeout: 30_000,
	});

	await page.goto('/projects');
	await expect(page.getByRole('heading', { name: 'Default' })).toBeVisible();
	await expect(page.getByText('First Run Witness', { exact: true }).first()).toBeVisible();
});

async function createProject(page: Page, name: string): Promise<string> {
	await page.goto('/projects');
	await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
	const input = page.getByPlaceholder('New project name');
	await input.fill(name);
	await input.press('Enter');
	await expect(page.getByRole('heading', { name })).toBeVisible();
	const href = await page.getByRole('link', { name: 'New Transcription' }).getAttribute('href');
	const projectId = new URL(href!, page.url()).searchParams.get('projectId');
	if (!projectId) throw new Error(`New Transcription link did not identify ${name}`);
	return projectId;
}

async function fillTranscriptionForm(page: Page, title: string, siglum: string): Promise<void> {
	await page.locator('input[name="title"]').fill(title);
	await page.locator('input[name="siglum"]').fill(siglum);
	await page.locator('input[name="transcriber"]').fill('E2E Editor');
	await page.locator('input[name="repository"]').fill('E2E Library');
	await page.locator('input[name="settlement"]').fill('Test City');
	await page.locator('input[name="language"]').fill('Greek');
}
