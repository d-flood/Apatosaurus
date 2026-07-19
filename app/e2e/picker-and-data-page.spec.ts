import { expect, test, type Page } from '@playwright/test';

test('project picker opens projects and contains no storage tools', async ({ page }) => {
	const projectId = await createProject(page, 'Picker Project');
	await expect(page).toHaveURL(`/projects/${projectId}/transcriptions`);

	await page.goto('/projects');
	await expect(page.getByRole('heading', { name: 'Picker Project' })).toBeVisible();
	const pickerCard = page.locator('article', {
		has: page.getByRole('heading', { name: 'Picker Project' }),
	});
	await expect(pickerCard.getByRole('link', { name: 'Open' })).toHaveAttribute(
		'href',
		`/projects/${projectId}/transcriptions`
	);
	await expect(page.getByText('No projects yet')).not.toBeVisible();
	await expect(page.getByText('Storage Durability')).not.toBeVisible();
	await expect(page.getByText('Whole-Account Export')).not.toBeVisible();
	await expect(page.getByText('Repair Database')).not.toBeVisible();
});

test('data and storage page exports, repairs, and links to project backups', async ({ page }) => {
	const projectId = await createProject(page, 'Data Project');
	await page.goto('/data');

	await expect(page.getByRole('heading', { name: 'Data & Storage' })).toBeVisible();
	await expect(page.getByRole('link', { name: /Data Project/ })).toHaveAttribute(
		'href',
		`/projects/${projectId}/backup`
	);

	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export all projects' }).click();
	await downloadPromise;

	await page.getByRole('button', { name: 'Repair database' }).click();
	await expect(page.getByText('Repair complete')).toBeVisible({ timeout: 30_000 });
});

async function createProject(page: Page, name: string): Promise<string> {
	await page.goto('/projects');
	await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
	const input = page.getByPlaceholder('New project name');
	await input.fill(name);
	await input.press('Enter');
	await expect(page.getByRole('heading', { name })).toBeVisible();
	const match = new URL(page.url()).pathname.match(/^\/projects\/([^/]+)\/transcriptions$/);
	expect(match).not.toBeNull();
	return match![1]!;
}
