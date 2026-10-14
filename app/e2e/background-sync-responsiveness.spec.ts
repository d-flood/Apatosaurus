import { expect, test, type Page } from '@playwright/test';
import { FakeGoogleSignIn } from './fake-google-sign-in';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

async function createProjectInSlowDrive(page: Page): Promise<string> {
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
	const projectId = new URL(page.url()).pathname.split('/')[2]!;
	await page
		.getByRole('region', { name: 'Storage', exact: true })
		.getByRole('button', { name: 'Sign in with Google Drive' })
		.click();
	const dialog = page.getByRole('dialog', { name: 'Back up projects' });
	await expect(dialog).toBeVisible({ timeout: 30_000 });
	await dialog.getByRole('button', { name: 'Move', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 60_000 });
	return projectId;
}

async function navigateInApp(page: Page, path: string): Promise<void> {
	await page.evaluate(href => {
		const link = document.createElement('a');
		link.href = href;
		document.body.append(link);
		link.click();
		link.remove();
	}, path);
}

test('opening a project does not wait behind background cloud requests', async ({ page }) => {
	await createProjectInSlowDrive(page);

	await page.goto('/data');
	const project = page.getByRole('link', { name: /Latency Romans/ });
	await expect(project).toContainText('Synced', { timeout: 60_000 });
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	const started = Date.now();
	await project.click();
	await expect(page.getByTestId('project-location')).toBeVisible();

	expect(Date.now() - started).toBeLessThan(1_000);
});

test('pages do not wait behind a sync that is uploading local edits', async ({ page }) => {
	const projectId = await createProjectInSlowDrive(page);
	await page.goto(`/transcription/new?projectId=${projectId}`);
	await expect(page.getByRole('combobox', { name: 'Project*' })).toHaveValue(projectId);
	await page.locator('input[name="title"]').fill('Upload Witness');
	await page.locator('input[name="siglum"]').fill('UPL');
	await page.locator('input[name="transcriber"]').fill('E2E Editor');
	await page.locator('input[name="repository"]').fill('E2E Library');
	await page.locator('input[name="settlement"]').fill('Test City');
	await page.locator('input[name="language"]').fill('Greek');
	const upload = page.waitForRequest(request => request.url().includes('/upload/drive/v3/'), {
		timeout: 60_000,
	});
	await page.getByRole('button', { name: 'Create Transcription' }).click();
	await expect(page.getByRole('heading', { name: 'Upload Witness' })).toBeVisible({
		timeout: 30_000,
	});
	await upload;

	const started = Date.now();
	await navigateInApp(page, `/projects/${projectId}/location`);
	await expect(page.getByTestId('project-location')).toBeVisible();

	expect(Date.now() - started).toBeLessThan(1_000);
});
