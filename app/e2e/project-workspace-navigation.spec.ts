import { expect, test, type Page } from '@playwright/test';

test('project workspace sections are bookmarkable and stay isolated across tabs', async ({
	context,
	page,
}) => {
	await createProject(page, 'Workspace Alpha');
	await createProject(page, 'Workspace Beta');
	const projectIds = await readProjectIdsByName(page);
	const alphaId = projectIds['Workspace Alpha'];
	const betaId = projectIds['Workspace Beta'];
	expect(alphaId).toBeTruthy();
	expect(betaId).toBeTruthy();

	await page.goto(`/projects/${alphaId}/transcriptions`);
	await expect(page.getByRole('heading', { name: 'Workspace Alpha' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Project Transcriptions' })).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('lastOpenedProjectId')))
		.toBe(alphaId);

	const sections = [
		{ name: 'Collations', path: 'collations', heading: 'Project Collations' },
		{ name: 'Settings', path: 'settings', heading: 'Project Details' },
		{ name: 'Backup and Sync', path: 'backup', heading: 'Folder Sync' },
		{ name: 'Transcriptions', path: 'transcriptions', heading: 'Project Transcriptions' },
	] as const;
	for (const section of sections) {
		await page.locator('.tabs').getByRole('link', { name: section.name, exact: true }).click();
		await expect(page).toHaveURL(`/projects/${alphaId}/${section.path}`);
		await expect(page.getByRole('heading', { name: section.heading })).toBeVisible();
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Workspace Alpha' })).toBeVisible();
		await expect(page.getByRole('heading', { name: section.heading })).toBeVisible();
	}

	const betaPage = await context.newPage();
	await betaPage.goto(`/projects/${betaId}/collations`);
	await expect(betaPage.getByRole('heading', { name: 'Workspace Beta' })).toBeVisible();
	await expect(betaPage.getByRole('heading', { name: 'Project Collations' })).toBeVisible();

	await page.reload();
	await expect(page).toHaveURL(`/projects/${alphaId}/transcriptions`);
	await expect(page.getByRole('heading', { name: 'Workspace Alpha' })).toBeVisible();
	await expect(betaPage).toHaveURL(`/projects/${betaId}/collations`);
	await expect(betaPage.getByRole('heading', { name: 'Workspace Beta' })).toBeVisible();
});

async function createProject(page: Page, name: string): Promise<void> {
	await page.goto('/projects');
	await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
	const input = page.getByPlaceholder('New project name');
	await input.fill(name);
	await input.press('Enter');
	await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function readProjectIdsByName(page: Page): Promise<Record<string, string>> {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const app = await root.getDirectoryHandle('apatosaurus');
		const version = await app.getDirectoryHandle('v1');
		const projects = await version.getDirectoryHandle('projects');
		const ids: Record<string, string> = {};
		for await (const handle of projects.values()) {
			if (handle.kind !== 'directory') continue;
			const manifestHandle = await handle.getFileHandle('project.json');
			const manifest = JSON.parse(await (await manifestHandle.getFile()).text()) as {
				id: string;
				name: string;
			};
			ids[manifest.name] = manifest.id;
		}
		return ids;
	});
}
