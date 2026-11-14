export async function hardGoto(page, url) {
	if (page.url() !== 'about:blank') {
		await page.goto('about:blank');
		await page.waitForTimeout(3000);
	}
	await page.goto(url);
}

export const WITS = ['P46', '01', '02', '03', '04', '012', '33', '1739', '1881', '1', '6'];

export const RULES = [{ pattern: 'σι$', replacement: 'σιν', description: 'Movable nu' }];

export async function seed(page, BASE, { log = console.log } = {}) {
	await hardGoto(page, BASE + '/projects');
	await page.getByPlaceholder('New project name').fill('Romans 8:28');
	await page.getByRole('button', { name: 'Create' }).click();
	await page.waitForURL(/\/projects\/[^/]+\/transcriptions$/);
	const projectId = page.url().match(/projects\/([^/]+)\//)[1];
	log('project', projectId);

	await hardGoto(page, `${BASE}/transcription/igntp?projectId=${projectId}`);
	await page.getByRole('heading', { name: 'Import Provided Transcriptions' }).waitFor();
	for (const w of WITS)
		await page.getByRole('checkbox', { name: `NT_GRC_${w}_Rom.xml`, exact: true }).check();
	await page.getByRole('button', { name: /Import Selected/ }).click();
	await page
		.getByText(new RegExp(`^Imported ${WITS.length}, skipped 0,\\s+failed 0`))
		.first()
		.waitFor({ state: 'attached', timeout: 180_000 });
	log('imported');

	return projectId;
}

export async function configureSettings(page, BASE, projectId, { log = console.log } = {}) {
	await hardGoto(page, `${BASE}/projects/${projectId}/settings`);
	await page
		.getByRole('heading', { name: 'Project Collation Settings' })
		.waitFor({ timeout: 60_000 });
	await page.waitForTimeout(2000);
	const wordBreaks = page
		.locator('label', { hasText: 'Ignore word breaks' })
		.getByRole('checkbox');
	if (!(await wordBreaks.isChecked())) await wordBreaks.check();
	await page.waitForTimeout(3000);
	for (const rule of RULES) {
		await page.getByPlaceholder('e.g. θς').first().fill(rule.pattern);
		await page.getByPlaceholder('e.g. θεος').first().fill(rule.replacement);
		await page.getByPlaceholder('Optional note').first().fill(rule.description);
		await page.getByRole('button', { name: 'Add Project Rule' }).click();
		await page.getByText(rule.description, { exact: true }).waitFor();
		await page.waitForTimeout(4000);
	}
	log('settings configured');
}
