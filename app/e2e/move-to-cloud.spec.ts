import { expect, test, type Page } from '@playwright/test';
import { FakeGoogleSignIn } from './fake-google-sign-in';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

function storageBanner(page: Page) {
	return page.getByRole('region', { name: 'Storage', exact: true });
}

function moveDialog(page: Page) {
	return page.getByRole('dialog', { name: 'Back up projects' });
}

async function createProject(page: Page, name: string): Promise<string> {
	await page.goto('/projects');
	await page.getByPlaceholder('New project name').fill(name);
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(page).toHaveURL(/\/projects\/[^/]+\/transcriptions$/);
	return new URL(page.url()).pathname.split('/')[2]!;
}

async function createTranscription(page: Page, projectId: string): Promise<void> {
	await page.goto(`/transcription/new?projectId=${projectId}`);
	await expect(page.getByRole('combobox', { name: 'Project*' })).toHaveValue(projectId);
	await page.locator('input[name="title"]').fill('Move Witness');
	await page.locator('input[name="siglum"]').fill('MOV');
	await page.locator('input[name="transcriber"]').fill('E2E Editor');
	await page.locator('input[name="repository"]').fill('E2E Library');
	await page.locator('input[name="settlement"]').fill('Test City');
	await page.locator('input[name="language"]').fill('Greek');
	await page.getByRole('button', { name: 'Create Transcription' }).click();
	await expect(page.getByRole('heading', { name: 'Move Witness' })).toBeVisible({
		timeout: 30_000,
	});
}

async function apatosaurusFilePaths(harness: FakeGoogleSignIn): Promise<string[]> {
	const root = harness.drive.findByName('Apatosaurus');
	if (!root) return [];
	const token = await harness.drive.tokens.getAccessToken();
	const list = async (parentId: string, prefix: string): Promise<string[]> => {
		const params = new URLSearchParams({
			q: `'${parentId}' in parents and trashed = false`,
			pageSize: '100',
			supportsAllDrives: 'true',
		});
		const response = await harness.drive.fetch(
			`https://www.googleapis.com/drive/v3/files?${params}`,
			{ headers: { Authorization: `Bearer ${token}` } }
		);
		const { files } = (await response.json()) as {
			files: { id: string; name: string; mimeType: string }[];
		};
		const nested = await Promise.all(
			files.map(file =>
				file.mimeType === 'application/vnd.google-apps.folder'
					? list(file.id, `${prefix}${file.name}/`)
					: [`${prefix}${file.name}`]
			)
		);
		return nested.flat();
	};
	return list(root.id, '');
}

test('signing in from the banner offers to move the project, and Move puts it in Drive', async ({
	page,
}) => {
	const harness = new FakeGoogleSignIn();
	await harness.install(page);
	const projectId = await createProject(page, 'Move Romans');
	await createTranscription(page, projectId);
	const projectPath = `/projects/${projectId}/transcriptions`;
	await page.goto(projectPath);

	await storageBanner(page).getByRole('button', { name: 'Sign in with Google Drive' }).click();

	const dialog = moveDialog(page);
	await expect(dialog).toBeVisible({ timeout: 30_000 });
	await expect(page).toHaveURL(new RegExp(`${projectPath}$`));
	await expect(dialog.getByRole('checkbox', { name: 'Move Romans' })).toBeChecked();
	await expect(dialog).toContainText('Moves to Google Drive/Apatosaurus');
	await dialog.getByRole('button', { name: 'Move', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 60_000 });

	const paths = await apatosaurusFilePaths(harness);
	expect(paths).toContainEqual(expect.stringMatching(/^move-romans-[^/]+\/project\.json$/));
	expect(paths).toContainEqual(
		expect.stringMatching(/^move-romans-[^/]+\/transcriptions\/[^/]+\.json$/)
	);
	await expect(storageBanner(page)).toHaveCount(0);

	await page.goto(`/projects/${projectId}/location`);
	await expect(page.getByTestId('project-location')).toHaveText('Google Drive/Apatosaurus');
	await expect(page.getByText('Status', { exact: true }).locator('xpath=..')).toContainText(
		'Synced',
		{ timeout: 30_000 }
	);
});

test('Not now leaves the project not backed up behind a banner that reopens the move', async ({
	page,
}) => {
	const harness = new FakeGoogleSignIn();
	await harness.install(page);
	const projectId = await createProject(page, 'Later Romans');
	const projectPath = `/projects/${projectId}/transcriptions`;

	await storageBanner(page).getByRole('button', { name: 'Sign in with Google Drive' }).click();
	const dialog = moveDialog(page);
	await expect(dialog).toBeVisible({ timeout: 30_000 });
	await expect(page).toHaveURL(new RegExp(`${projectPath}$`));
	await dialog.getByRole('button', { name: 'Not now' }).click();
	await expect(dialog).toBeHidden();

	const banner = storageBanner(page);
	await expect(banner).toContainText(
		'1 project not backed up · Move to Google Drive/Apatosaurus'
	);
	expect(await apatosaurusFilePaths(harness)).not.toContainEqual(
		expect.stringMatching(/^later-romans-/)
	);

	await banner.getByRole('button', { name: 'Move', exact: true }).click();
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('checkbox', { name: 'Later Romans' })).toBeChecked();
});
