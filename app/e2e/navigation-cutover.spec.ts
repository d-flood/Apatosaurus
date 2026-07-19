import { expect, test, type Page } from '@playwright/test';

test.setTimeout(120_000);

test('navbar falls back to the picker and hides development tools in production', async ({
	page,
}) => {
	await page.goto('/');
	const navbar = page.getByRole('navigation', { name: 'Primary' });

	await navbar.getByRole('link', { name: 'Transcriptions', exact: true }).click();
	await expect(page).toHaveURL('/projects');

	await navbar.getByRole('link', { name: 'Collations', exact: true }).click();
	await expect(page).toHaveURL('/projects');

	await navbar.getByRole('link', { name: 'Data & Storage' }).click();
	await expect(page).toHaveURL('/data');
	await expect(navbar.getByRole('button', { name: 'Reset DB' })).toHaveCount(0);
});

test('navbar follows the last-opened project and the switcher preserves the workspace section', async ({
	page,
}) => {
	const alphaId = await createProject(page, 'Navigation Alpha');
	const betaId = await createProject(page, 'Navigation Beta');
	const editorPath = await createTranscription(page, betaId);
	const navbar = page.getByRole('navigation', { name: 'Primary' });

	await page.goto(`/projects/${betaId}/transcriptions`);
	await expect(
		navbar.getByRole('button', { name: /Open project switcher: Navigation Beta/ })
	).toBeVisible();
	await page.goto('/projects');
	await expect(
		navbar.getByRole('button', { name: /Open project switcher: Navigation Beta/ })
	).toBeVisible();
	await navbar.getByRole('link', { name: 'Transcriptions', exact: true }).click();
	await expect(page).toHaveURL(`/projects/${betaId}/transcriptions`);

	await navbar.getByRole('link', { name: 'Collations', exact: true }).click();
	await expect(page).toHaveURL(`/projects/${betaId}/collations`);

	await page.goto(`/projects/${alphaId}/collations`);
	await navbar.getByRole('button', { name: /Open project switcher: Navigation Alpha/ }).click();
	await navbar.getByRole('link', { name: 'Navigation Beta', exact: true }).click();
	await expect(page).toHaveURL(`/projects/${betaId}/collations`);

	await navbar.getByRole('button', { name: /Open project switcher: Navigation Beta/ }).click();
	await navbar.getByRole('link', { name: 'Manage projects…', exact: true }).click();
	await expect(page).toHaveURL('/projects');

	await page.goto(`/projects/${alphaId}/transcriptions`);
	await expect(
		navbar.getByRole('button', { name: /Open project switcher: Navigation Alpha/ })
	).toBeVisible();
	await page.goto(editorPath);
	await expect(
		navbar.getByRole('button', { name: /Open project switcher: Navigation Alpha/ })
	).toBeVisible();
	await navbar.getByRole('link', { name: 'Collations', exact: true }).click();
	await expect(page).toHaveURL(`/projects/${alphaId}/collations`);

	await page.goto(editorPath);
	await expect(
		navbar.getByRole('button', { name: /Open project switcher: Navigation Alpha/ })
	).toBeVisible();
	await navbar.getByRole('link', { name: 'Transcriptions', exact: true }).click();
	await expect(page).toHaveURL(`/projects/${alphaId}/transcriptions`);
});

test('mobile navigation mirrors project targets', async ({ page }) => {
	const projectId = await createProject(page, 'Mobile Project');
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`/projects/${projectId}/settings`);
	const navbar = page.getByRole('navigation', { name: 'Primary' });

	await navbar.getByRole('button', { name: 'Open navigation menu' }).click();
	await expect(navbar.getByRole('link', { name: 'Transcriptions', exact: true })).toHaveAttribute(
		'href',
		`/projects/${projectId}/transcriptions`
	);
	await expect(navbar.getByRole('link', { name: 'Collations', exact: true })).toHaveAttribute(
		'href',
		`/projects/${projectId}/collations`
	);
	await expect(navbar.getByRole('link', { name: 'Mobile Project', exact: true })).toHaveAttribute(
		'href',
		`/projects/${projectId}/settings`
	);
	await expect(
		navbar.getByRole('link', { name: 'Manage projects…', exact: true })
	).toHaveAttribute('href', '/projects');
});

test('legacy document list URLs redirect into the last-opened project', async ({ page }) => {
	const projectId = await createProject(page, 'Legacy Navigation');

	await page.goto('/transcription');
	await expect(page).toHaveURL(`/projects/${projectId}/transcriptions`);

	await page.goto('/collation');
	await expect(page).toHaveURL(`/projects/${projectId}/collations`);
});

async function createProject(page: Page, name: string): Promise<string> {
	await page.goto('/projects');
	await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
	const input = page.getByPlaceholder('New project name');
	await input.fill(name);
	await input.press('Enter');
	await expect(page.getByRole('heading', { name })).toBeVisible();
	const match = new URL(page.url()).pathname.match(/^\/projects\/([^/]+)\/transcriptions$/);
	if (!match?.[1]) throw new Error(`Project URL did not identify ${name}`);
	return match[1];
}

async function createTranscription(page: Page, projectId: string): Promise<string> {
	await page.goto(`/transcription/new?projectId=${projectId}`);
	await expect(page.getByRole('combobox', { name: 'Project*' })).toHaveValue(projectId);
	await page.locator('input[name="title"]').fill('Navigation Witness');
	await page.locator('input[name="siglum"]').fill('NAV');
	await page.locator('input[name="transcriber"]').fill('E2E Editor');
	await page.locator('input[name="repository"]').fill('E2E Library');
	await page.locator('input[name="settlement"]').fill('Test City');
	await page.locator('input[name="language"]').fill('Greek');
	await page.getByRole('button', { name: 'Create Transcription' }).click();
	await expect(page.getByRole('heading', { name: 'Navigation Witness' })).toBeVisible({
		timeout: 30_000,
	});
	return new URL(page.url()).pathname;
}
