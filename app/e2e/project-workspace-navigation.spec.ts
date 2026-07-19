import { expect, test, type Page } from '@playwright/test';

test.setTimeout(120_000);

test('project libraries are clean worklists and collation configuration lives in settings', async ({
	page,
}) => {
	await createProjectWithoutNavigation(page, 'Clean Libraries');
	const projectIds = await readProjectIdsByName(page);
	const projectId = projectIds['Clean Libraries'];
	expect(projectId).toBeTruthy();
	await seedProjectDocuments(page, projectId);

	await page.goto(`/projects/${projectId}/transcriptions`);
	const transcriptionRow = page.getByRole('listitem').filter({ hasText: 'GA 459' });
	await expect(transcriptionRow).toContainText('Pluteo IV. 32');
	await expect(transcriptionRow).toContainText('Committed');
	await expect(transcriptionRow).toContainText('Updated');
	await expect(transcriptionRow.getByRole('link', { name: 'Open' })).toBeVisible();
	await expect(page.getByText('Corrector treatment', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Project Transcription Versions' })).toHaveCount(
		0
	);

	await page.goto(`/projects/${projectId}/settings`);
	await expect(page.getByRole('heading', { name: 'Project Details' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Project Collation Settings' })).toBeVisible();
	await expect(page.getByText('Corrector treatment', { exact: true })).toBeVisible();
	await expect(page.getByText('Included hands')).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'Project Transcription Versions' })
	).toBeVisible();

	const lowercaseToggle = page.getByRole('checkbox', { name: /Lowercase for alignment/ });
	await lowercaseToggle.check();
	await expect(page.getByText('Saving project settings')).toHaveCount(1);
	await expect(page.getByText('Saving project settings')).toHaveCount(0);
	const treatmentToggle = page.locator('[data-treatment-control]').getByRole('checkbox');
	await treatmentToggle.check();
	await expect(page.getByText('Saving project settings')).toHaveCount(1);
	await expect(page.getByText('Saving project settings')).toHaveCount(0);
	const correctorToggle = page.locator('[data-hand-control]').getByRole('checkbox').last();
	await correctorToggle.uncheck();
	await expect(page.getByText('Saving project settings')).toHaveCount(1);
	await expect(page.getByText('Saving project settings')).toHaveCount(0);
	await page.reload();
	await expect(lowercaseToggle).toBeChecked();
	await expect(treatmentToggle).toBeChecked();
	await expect(correctorToggle).not.toBeChecked();

	await page.goto(`/projects/${projectId}/collations`);
	const collationRow = page.getByRole('listitem').filter({ hasText: 'Collation Rom' });
	await expect(collationRow).toBeVisible();
	await collationRow.getByLabel(/More actions/).click();
	page.once('dialog', dialog => dialog.dismiss());
	await collationRow.getByRole('button', { name: 'Delete' }).click();
	await expect(collationRow).toBeVisible();
	page.once('dialog', dialog => dialog.accept());
	await collationRow.getByRole('button', { name: 'Delete' }).click();
	await expect(collationRow).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole('listitem').filter({ hasText: 'Collation Rom' })).toHaveCount(0);

	await page.goto(`/projects/${projectId}/transcriptions`);
	const persistedTranscriptionRow = page.getByRole('listitem').filter({ hasText: 'GA 459' });
	await persistedTranscriptionRow.getByLabel(/More actions/).click();
	page.once('dialog', dialog => dialog.dismiss());
	await persistedTranscriptionRow.getByRole('button', { name: 'Delete' }).click();
	await expect(persistedTranscriptionRow).toBeVisible();
	page.once('dialog', dialog => dialog.accept());
	await persistedTranscriptionRow.getByRole('button', { name: 'Delete' }).click();
	await expect(persistedTranscriptionRow).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole('listitem').filter({ hasText: 'GA 459' })).toHaveCount(0);
});

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

async function createProjectWithoutNavigation(page: Page, name: string): Promise<void> {
	await createProject(page, name);
}

async function seedProjectDocuments(page: Page, projectId: string): Promise<void> {
	await page.goto(`/transcription/igntp?projectId=${projectId}`);
	await page.getByRole('combobox', { name: 'Import into project' }).selectOption(projectId);
	await page
		.getByRole('searchbox', { name: 'Search provided transcriptions' })
		.fill('NT_GRC_459_Rom.xml');
	await page.getByRole('checkbox', { name: 'NT_GRC_459_Rom.xml' }).check();
	await page.getByRole('button', { name: 'Import Selected (1)' }).click();
	await expect(page.getByText('Imported GA 459.').last()).toBeVisible({ timeout: 60_000 });

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
}
