import { expect, test, type Browser, type Page } from '@playwright/test';
import { SharedFolderServer } from './shared-folder-server';

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

	await page.goto(`/projects/${switchedProjectId}/transcriptions`);
	await expect(page.getByText('Switched Project Witness', { exact: true }).first()).toBeVisible();
	await page.evaluate(projectId => {
		localStorage.setItem('lastOpenedProjectId', projectId);
	}, lastOpenedProjectId);

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
	await page.getByRole('link', { name: 'Open' }).click();
	await expect(page.getByText('First Run Witness', { exact: true }).first()).toBeVisible();
});

test('creating a project asks no location question with one place', async ({
	browser,
	baseURL,
}) => {
	const sharedFolder = new SharedFolderServer();
	const page = await newFolderContextPage(browser, sharedFolder, baseURL);

	await page.goto('/projects');
	await expect(page.getByPlaceholder('New project name')).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Location' })).toHaveCount(0);
	await expect(
		page
			.getByText(
				'Saves only in this browser · Sign in with Google Drive or Dropbox to back up'
			)
			.first()
	).toBeVisible();
	await createProject(page, 'Browser Only Project');

	await addFolderLocation(page, 'Desk Folder');
	await page.goto('/projects');
	await expect(page.getByPlaceholder('New project name')).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Location' })).toHaveCount(0);
	await expect(page.getByText('Saves to Desk Folder').first()).toBeVisible();
	await createProject(page, 'Desk Project');

	await page.goto('/projects');
	await expect(
		page
			.getByRole('region', { name: 'Not backed up' })
			.getByRole('heading', { name: 'Browser Only Project' })
	).toBeVisible();
	await expect(
		page
			.getByRole('region', { name: 'Desk Folder' })
			.getByRole('heading', { name: 'Desk Project' })
	).toBeVisible();
});

test('creating a project with two locations offers a picker defaulting to the last used', async ({
	browser,
	baseURL,
}) => {
	const sharedFolder = new SharedFolderServer();
	const page = await newFolderContextPage(browser, sharedFolder, baseURL);
	await addFolderLocation(page, 'Desk Folder');
	sharedFolder.forgetLocationMarker();
	await addFolderLocation(page, 'Lab Folder');

	await page.goto('/projects');
	const location = page.getByRole('combobox', { name: 'Location' }).first();
	await expect(location.locator('option:checked')).toHaveText('Desk Folder');
	await location.selectOption({ label: 'Lab Folder' });
	await page.getByPlaceholder('New project name').fill('Lab Project');
	await page.getByRole('button', { name: 'Create' }).click();
	await expect(page.getByRole('heading', { name: 'Lab Project' })).toBeVisible();

	await page.goto('/projects');
	await expect(location.locator('option:checked')).toHaveText('Lab Folder');
	await expect(
		page
			.getByRole('region', { name: 'Lab Folder' })
			.getByRole('heading', { name: 'Lab Project' })
	).toBeVisible();
});

async function newFolderContextPage(
	browser: Browser,
	sharedFolder: SharedFolderServer,
	baseURL: string | undefined
): Promise<Page> {
	const context = await browser.newContext({ baseURL });
	await context.addInitScript(() => {
		Object.defineProperty(window, 'showDirectoryPicker', {
			configurable: true,
			value: async () => ({
				kind: 'directory',
				name: (window as Window & { e2eFolderName?: string }).e2eFolderName,
				queryPermission: async () => 'granted',
				requestPermission: async () => 'granted',
			}),
		});
	});
	await context.route('**/__e2e-shared-folder', route => sharedFolder.handle(route));
	return context.newPage();
}

async function addFolderLocation(page: Page, name: string): Promise<void> {
	await page.goto('/data');
	await page.evaluate(folderName => {
		(window as Window & { e2eFolderName?: string }).e2eFolderName = folderName;
	}, name);
	await page.getByRole('button', { name: 'Add folder on this computer' }).click();
	await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible({
		timeout: 30_000,
	});
}

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
