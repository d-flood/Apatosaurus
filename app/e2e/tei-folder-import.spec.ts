import { expect, test } from '@playwright/test';
import { copyFileSync, cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.setTimeout(120_000);

test('imports a folder of TEI files, filling gaps from defaults, skipping or replacing duplicates', async ({
	page,
}, testInfo) => {
	const folder = mkdtempSync(join(tmpdir(), `tei-folder-${testInfo.workerIndex}-`));
	copyFileSync(
		join(import.meta.dirname, '../src/lib/tei/NT_GRC_01_Rom.xml'),
		join(folder, '01.xml')
	);
	const writeSparse = (root: string, word: string) =>
		writeFileSync(
			join(root, 'Sparse.xml'),
			`<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt/></fileDesc></teiHeader><text><body><pb n="1r"/><cb n="1"/><lb n="1"/><w>${word}</w></body></text></TEI>`
		);
	writeSparse(folder, 'λογος');
	writeFileSync(join(folder, 'broken.xml'), '<TEI><teiHeader>');
	writeFileSync(join(folder, 'notes.txt'), 'ignore me');

	await page.goto('/projects');
	const projectName = page.getByPlaceholder('New project name');
	await projectName.fill('TEI Folder Project');
	await projectName.press('Enter');
	await expect(page).toHaveURL(/\/projects\/[^/]+\/transcriptions$/);
	const transcriptionsUrl = page.url();
	await page.getByRole('link', { name: 'Import TEI Folder' }).click();
	const importButton = page.getByRole('button', { name: /Import \d+ TEI/ });
	await page.getByTestId('tei-folder-input').setInputFiles(folder);
	await expect(importButton).toHaveText('Import 3 TEI files');

	await importButton.click();
	const results = page.getByTestId('tei-folder-import-results');
	await expect(results).toContainText('Imported 1, replaced 0, skipped 0, failed 2.', {
		timeout: 60_000,
	});
	await expect(results).toContainText(
		'Missing required metadata: transcriber, repository, settlement, language'
	);

	await page.getByLabel('Transcriber').fill('Tester');
	await page.getByLabel('Repository').fill('Library');
	await page.getByLabel('Settlement').fill('City');
	await page.getByLabel('Language').fill('grc');
	await importButton.click();
	await expect(results).toContainText('Imported 1, replaced 0, skipped 1, failed 1.', {
		timeout: 60_000,
	});
	await expect(results).toContainText('Imported Sparse.');
	await expect(results).toContainText('Already imported; not updated.');

	const updated = mkdtempSync(join(tmpdir(), `tei-folder-updated-${testInfo.workerIndex}-`));
	cpSync(folder, updated, { recursive: true });
	writeSparse(updated, 'ἀγαπη');
	await page.getByTestId('tei-folder-input').setInputFiles(updated);
	await page.getByLabel('Replace matching transcriptions in this project').check();
	await importButton.click();
	await expect(results).toContainText('Imported 0, replaced 2, skipped 0, failed 1.', {
		timeout: 60_000,
	});
	await expect(results).toContainText('Replaced Sparse.');

	await page.goto(transcriptionsUrl);
	await page
		.getByRole('list', { name: 'Transcriptions' })
		.getByRole('listitem')
		.filter({ hasText: 'Sparse' })
		.getByRole('link', { name: 'Open' })
		.click();
	await expect(page.locator('.ProseMirror')).toContainText('ἀγαπη', { timeout: 30_000 });
});
